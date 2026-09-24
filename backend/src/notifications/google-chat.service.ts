import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Best-effort by design (TRD): a failed or unconfigured Chat webhook must
// never block the action that triggered it. GOOGLE_CHAT_WEBHOOK_URL is
// intentionally not in validate-env's required keys — not every environment
// has Chat set up, and this channel is a convenience, not a security control.
@Injectable()
export class GoogleChatService {
  private readonly logger = new Logger(GoogleChatService.name);
  private readonly webhookUrl?: string;

  constructor(config: ConfigService) {
    this.webhookUrl =
      config.get<string>('GOOGLE_CHAT_WEBHOOK_URL') || undefined;
  }

  async notify(text: string): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (error) {
      this.logger.warn(`Google Chat notification failed: ${String(error)}`);
    }
  }
}
