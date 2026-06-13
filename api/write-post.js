export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Password check via Basic Auth
  const auth = req.headers.authorization || "";
  const [scheme, encoded] = auth.split(" ");
  if (scheme !== "Basic" || !encoded) {
    return res.status(401).json({ error: "需要登录" });
  }
  const [user, pass] = Buffer.from(encoded, "base64").toString().split(":");
  if (pass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "密码错误" });
  }

  const body = req.body || {};

  // Just checking auth
  if (body.action === "check") {
    return res.json({ ok: true });
  }

  // Publishing a post
  const { title, date, categories, tags, content } = body;

  if (!title || !content) {
    return res.status(400).json({ error: "标题和正文不能为空" });
  }

  // Build frontmatter
  const tagList = (tags || [])
    .filter(Boolean)
    .map((t) => `  - ${t}`)
    .join("\n");

  const frontmatter = [
    "---",
    `title: ${title}`,
    `date: ${date || new Date().toISOString().split("T")[0]}`,
    categories ? `categories: ${categories}` : "",
    tagList ? "tags:" : "",
    tagList,
    "---",
    "",
    content,
  ]
    .filter((line) => line !== "")
    .join("\n");

  // Filename from title + date
  const dateStr = (date || new Date().toISOString().split("T")[0]).replace(
    /-/g,
    "/"
  );
  const safeTitle = title
    .replace(/\s+/g, "-")
    .replace(/[^\w一-鿿-]/g, "")
    .slice(0, 40)
    .toLowerCase();
  const filename = `${safeTitle || "post"}.md`;
  const path = `source/_posts/${filename}`;

  // Commit to GitHub
  const token = process.env.GITHUB_PAT;
  const repo = "milaotou001/my-blog";

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          message: `Add post: ${title}`,
          content: Buffer.from(frontmatter).toString("base64"),
          branch: "master",
        }),
      }
    );

    if (!resp.ok) {
      const err = await resp.json();
      return res
        .status(resp.status)
        .json({ error: err.message || "GitHub API 错误" });
    }

    return res.json({ ok: true, path });
  } catch (e) {
    return res.status(500).json({ error: "服务器错误: " + e.message });
  }
}
