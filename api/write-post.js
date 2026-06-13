export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const auth = req.headers.authorization || "";
  const [, encoded] = auth.split(" ");
  if (!encoded) return res.status(401).json({ error: "需要登录" });
  const [, pass] = Buffer.from(encoded, "base64").toString().split(":");
  if (pass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "密码错误" });
  }

  // Parse body manually to preserve UTF-8 encoding
  let body = {};
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf-8");
    body = JSON.parse(raw);
  } catch (e) {
    body = req.body || {};
  }
  const action = body.action || "publish";

  const token = process.env.GITHUB_PAT;
  const repo = "milaotou001/my-blog";
  const base = `https://api.github.com/repos/${repo}/contents/source/_posts`;
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };

  try {
    if (action === "check") {
      return res.json({ ok: true });
    }

    // --- List all posts ---
    if (action === "list") {
      const r = await fetch(base, { headers });
      const files = await r.json();
      if (!Array.isArray(files)) {
        return res.status(r.status).json({ error: files.message || "获取列表失败" });
      }
      const mdFiles = files
        .filter((f) => f.name.endsWith(".md"))
        .sort((a, b) => b.name.localeCompare(a.name));

      // Fetch each post's frontmatter title in parallel
      const posts = await Promise.all(
        mdFiles.map(async (f) => {
          try {
            const fr = await fetch(`${base}/${encodeURIComponent(f.name)}`, { headers });
            const fd = await fr.json();
            if (!fr.ok) return { name: f.name, path: f.path, sha: f.sha, title: f.name };
            const raw = Buffer.from(fd.content, "base64").toString("utf-8");
            const parsed = parseFrontmatter(raw);
            return { name: f.name, path: f.path, sha: f.sha, title: parsed.title || f.name, date: parsed.date };
          } catch {
            return { name: f.name, path: f.path, sha: f.sha, title: f.name };
          }
        })
      );
      return res.json(posts);
    }

    // --- Get single post ---
    if (action === "get") {
      const r = await fetch(`${base}/${encodeURIComponent(body.name)}`, { headers });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message });
      const raw = Buffer.from(data.content, "base64").toString("utf-8");
      const parsed = parseFrontmatter(raw);
      return res.json({ name: data.name, path: data.path, sha: data.sha, ...parsed });
    }

    // --- Update existing post ---
    if (action === "update") {
      if (!body.sha) return res.status(400).json({ error: "缺少文件 sha" });
      if (!body.title || !body.content) {
        return res.status(400).json({ error: "标题和正文不能为空" });
      }
      const md = buildMarkdown(body);

      async function tryUpdate(sha) {
        const r = await fetch(`${base}/${encodeURIComponent(body.name)}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            message: `Update: ${body.title}`,
            content: Buffer.from(md, "utf-8").toString("base64"),
            sha,
            branch: "master",
          }),
        });
        return { ok: r.ok, status: r.status, data: await r.json() };
      }

      let result = await tryUpdate(body.sha);
      // If SHA is stale, fetch the latest and retry once
      if (!result.ok && result.data.message && /does not match/i.test(result.data.message)) {
        const latest = await fetch(`${base}/${encodeURIComponent(body.name)}`, { headers });
        const latestData = await latest.json();
        if (latest.ok && latestData.sha) {
          result = await tryUpdate(latestData.sha);
        }
      }

      if (!result.ok) return res.status(result.status).json({ error: result.data.message });
      return res.json({ ok: true, sha: result.data.content.sha });
    }

    // --- Publish new post ---
    if (!body.title || !body.content) {
      return res.status(400).json({ error: "标题和正文不能为空" });
    }
    const md = buildMarkdown(body);
    const filename = makeFilename(body.title, body.date);
    const path = `source/_posts/${filename}`;

    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `Add post: ${body.title}`,
        content: Buffer.from(md, "utf-8").toString("base64"),
        branch: "master",
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message });
    return res.json({ ok: true, path });
  } catch (e) {
    return res.status(500).json({ error: "服务器错误: " + e.message });
  }
}

// --------- helpers ---------

function makeFilename(title, date) {
  const d = (date || new Date().toISOString().split("T")[0]).replace(/-/g, "");
  const slug = title
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_一-鿿]/gi, "")
    .slice(0, 30)
    .toLowerCase() || Date.now().toString(36);
  return `${d}-${slug}.md`;
}

function buildMarkdown({ title, date, categories, tags, content }) {
  const tagLines = (tags || []).filter(Boolean).map((t) => `  - ${t}`).join("\n");
  return [
    "---",
    `title: ${title}`,
    `date: ${date || new Date().toISOString().split("T")[0]}`,
    categories ? `categories: ${categories}` : "",
    tagLines ? "tags:" : "",
    tagLines,
    "---",
    "",
    content,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { title: "", date: "", categories: "", tags: [], content: raw };
  const fm = {};
  const lines = match[1].split("\n");
  let key = "";
  for (const line of lines) {
    const m = line.match(/^(\w+):\s*(.*)/);
    if (m) {
      key = m[1];
      fm[key] = m[2];
      if (key === "tags") fm[key] = [];
    } else if (key === "tags") {
      const t = line.match(/^\s+-\s+(.+)/);
      if (t) fm.tags.push(t[1]);
    }
  }
  fm.content = match[2].trim();
  return fm;
}
