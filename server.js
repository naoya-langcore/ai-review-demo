const http = require('http');
const fs = require('fs');
const path = require('path');

// .env ファイルから環境変数を読み込み
try {
  const envPath = path.join(__dirname, '.env');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...vals] = trimmed.split('=');
      process.env[key.trim()] = vals.join('=').trim();
    }
  });
} catch (e) { /* .env がなくても起動は可能 */ }

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// OpenAI API 共通呼び出し
async function callOpenAI(apiKey, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2048,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error: ${errText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from OpenAI');
  return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
}

// CORS ヘッダ設定
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// 単体審査: POST /api/review
async function handleReview(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured. Create a .env file with OPENAI_API_KEY=your_key' })); return; }

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { applicationData } = JSON.parse(body);

    const prompt = `あなたは私立中学校授業料支援助成金の審査AIです。以下の申請データを審査してください。

## 審査チェック項目（すべて確認すること）
1. 学年整合性：学年・入学年月が生年月日と矛盾しないか（例：中1なら入学年に12〜13歳であるべき）
2. 姓の一致：生徒の姓と申請者の姓が異なる場合は要確認（再婚等の可能性はあるがフラグを立てる）
3. 続柄確認：続柄が「父」または「母」になっているか（祖父母等は要確認）
4. 口座名義：口座名義カナが「申請者姓カナ＋スペース＋申請者名カナ」と一致するか
5. 在籍確認：在籍確認が「在籍中」であるか（「退学済み」「休学中」「確認不可」等はerrorとする）
6. 授業料妥当性：年間授業料が極端に低い（10万円未満）または高い（200万円超）でないか
7. 助成額上限チェック：この制度の助成額の上限は10万円（100,000円）と定められている。助成額が100,000円を超えている場合はerrorとする。※授業料との比較ではなく、制度上の上限額との比較であることに注意
8. 助成額と授業料の比較：助成額が年間授業料を超えている場合はerrorとする

## 申請データ
${JSON.stringify(applicationData, null, 2)}

## 回答形式
以下のJSON形式で回答してください。JSON以外は出力しないでください。

{
  "overall": "OK" または "要確認",
  "score": 0〜100の整数,
  "summary": "総合コメント（日本語で2-3文）",
  "findings": [
    {
      "severity": "error" または "warning" または "info",
      "category": "カテゴリ名",
      "message": "詳細メッセージ（日本語）",
      "field": "該当フィールド名 または null"
    }
  ]
}`;

    const result = await callOpenAI(apiKey, prompt);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error', message: err.message }));
  }
}

// 横断審査: POST /api/review-school
async function handleReviewSchool(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' })); return; }

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { schoolName, applications } = JSON.parse(body);

    const prompt = `あなたは私立中学校授業料支援助成金の審査AIです。同一学校「${schoolName}」の申請データ${applications.length}件を横断的にチェックしてください。

## 横断チェック項目
1. 在籍確認：在籍確認が「在籍中」でない申請がある場合、問題として検出する（type: "enrollment_issue"）
2. 授業料外れ値：同一学校内の年間授業料の中央値を求め、中央値の±70%を超える申請はerror、±30%を超える申請はwarningとする（type: "tuition_outlier"）
3. 助成額超過：助成額が制度上の上限額（100,000円）を超えている申請、または助成額が年間授業料を超えている申請を検出する（type: "subsidy_excess"）
4. 重複申請：生徒姓＋生徒名＋生年月日が完全一致する申請が2件以上ある場合、重複として検出する。申請者（父・母）が異なっていても同一生徒であれば重複とみなす（type: "duplicate"）。全申請の生徒姓・生徒名・生年月日を1件ずつ比較して確認すること

## 申請データ一覧
${JSON.stringify(applications, null, 2)}

## 回答形式
以下のJSON形式で回答してください。JSON以外は出力しないでください。
問題がなければ issues は空配列にしてください。

{
  "issues": [
    {
      "type": "enrollment_issue" または "tuition_outlier" または "subsidy_excess" または "duplicate",
      "title": "問題のタイトル（日本語）",
      "message": "詳細な説明（日本語、具体的な数値や受付番号を含めること）",
      "ids": ["該当する受付番号の配列"]
    }
  ]
}`;

    const result = await callOpenAI(apiKey, prompt);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error', message: err.message }));
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/review') { handleReview(req, res); return; }
  if (req.url === '/api/review-school') { handleReviewSchool(req, res); return; }

  // Static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.log('WARNING: OPENAI_API_KEY is not set. Create a .env file with OPENAI_API_KEY=your_key');
  } else {
    console.log('OpenAI API key loaded.');
  }
});
