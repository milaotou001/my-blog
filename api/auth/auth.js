export default function handler(req, res) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
  const redirectUri = `${siteUrl}/api/auth/callback`;

  const url = [
    "https://github.com/login/oauth/authorize",
    `?client_id=${clientId}`,
    "&scope=repo,user",
    `&redirect_uri=${encodeURIComponent(redirectUri)}`,
  ].join("");

  res.writeHead(302, { Location: url });
  res.end();
}
