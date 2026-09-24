import { ConflictException, Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  ListObjectVersionsCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CryptoService } from '../credentials/crypto.service';
import { Credential } from '../credentials/credential.entity';

export interface S3Target {
  bucket: string;
  region: string;
  key: string;
}

export interface S3ObjectSnapshot {
  text: string;
  etag: string | null;
}

export interface S3ObjectVersion {
  versionId: string;
  isLatest: boolean;
  lastModified: Date | undefined;
}

@Injectable()
export class S3ObjectService {
  constructor(private readonly crypto: CryptoService) {}

  async getText(
    credential: Credential,
    target: S3Target,
    versionId?: string,
  ): Promise<string> {
    return (await this.getObject(credential, target, versionId)).text;
  }

  // text '' and etag null for an object that doesn't exist yet — a freshly
  // connected component config has no S3 object until the first variable is
  // written. The etag goes back into putText so a concurrent write is caught.
  async getObject(
    credential: Credential,
    target: S3Target,
    versionId?: string,
  ): Promise<S3ObjectSnapshot> {
    const client = new S3Client({
      region: target.region,
      credentials: this.credentialsOf(credential),
    });
    try {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: target.bucket,
          Key: target.key,
          VersionId: versionId,
        }),
      );
      return {
        text: (await result.Body?.transformToString('utf-8')) ?? '',
        etag: result.ETag ?? null,
      };
    } catch (error) {
      if (error instanceof NoSuchKey) return { text: '', etag: null };
      throw error;
    }
  }

  // Conditional write (GAPS — lost-update race): only lands if the object is
  // still exactly what the caller read (If-Match), or still absent
  // (If-None-Match) — otherwise someone else wrote in between, and silently
  // overwriting would drop their change.
  async putText(
    credential: Credential,
    target: S3Target,
    content: string,
    expectedEtag: string | null,
  ): Promise<void> {
    const client = new S3Client({
      region: target.region,
      credentials: this.credentialsOf(credential),
    });
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: target.bucket,
          Key: target.key,
          Body: content,
          ContentType: 'text/plain',
          ...(expectedEtag ? { IfMatch: expectedEtag } : { IfNoneMatch: '*' }),
        }),
      );
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      // 412: the object changed; 409: a write raced this one mid-upload.
      if (status === 412 || status === 409) {
        throw new ConflictException(
          'These variables were just changed by someone else. Refresh and try again.',
        );
      }
      throw error;
    }
  }

  // Empty list for an object with no version history yet (never written, or
  // the bucket isn't versioned — Kosha assumes versioning is enabled per the
  // TRD, but a fresh/misconfigured bucket shouldn't crash the read path).
  async listVersions(
    credential: Credential,
    target: S3Target,
  ): Promise<S3ObjectVersion[]> {
    const client = new S3Client({
      region: target.region,
      credentials: this.credentialsOf(credential),
    });
    const result = await client.send(
      new ListObjectVersionsCommand({
        Bucket: target.bucket,
        Prefix: target.key,
      }),
    );
    return (result.Versions ?? [])
      .filter((v) => v.Key === target.key)
      .map((v) => ({
        versionId: v.VersionId!,
        isLatest: v.IsLatest ?? false,
        lastModified: v.LastModified,
      }));
  }

  private credentialsOf(credential: Credential) {
    const secret = JSON.parse(
      this.crypto.decrypt(credential.encryptedSecret),
    ) as {
      accessKeyId: string;
      secretAccessKey: string;
    };
    return {
      accessKeyId: secret.accessKeyId,
      secretAccessKey: secret.secretAccessKey,
    };
  }
}
