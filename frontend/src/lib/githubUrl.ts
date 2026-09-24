export interface ParsedGithubRepoUrl {
  repo: string;
}

// Paste the repo URL you're already looking at instead of typing "org/repo"
// yourself — same idea as the S3 URI box. Branch is always its own manual
// field (not derived from the URL), same as Region is for S3.
export function parseGithubRepoUrl(value: string): ParsedGithubRepoUrl | null {
  const match = /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?(?:[?#].*)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  return { repo: match[1] };
}
