export default async function handler(req, res) {
  const { code } = req.query;
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

  if (!code) {
    res.status(400).json({ error: "missing code" });
    return;
  }

  const tokenRes = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    }
  );

  const data = await tokenRes.json();

  if (data.error) {
    res.status(400).json({ error: data.error_description || data.error });
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>授权成功</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#333;text-align:center}</style></head>
<body><div><h2>授权成功</h2><p>窗口将自动关闭...</p></div>
<script>${postMessageScript(data.access_token)}</script>
</body></html>`);
}

function postMessageScript(token) {
  return `
(function(){
  var msg = ${JSON.stringify({ token, provider: "github" })};
  function send() {
    if (window.opener) {
      window.opener.postMessage(msg, window.opener.location.origin || "*");
      window.close();
    } else {
      document.querySelector("p").textContent = "请返回编辑器页面，已自动登录。";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", send);
  else send();
})();`;
}
