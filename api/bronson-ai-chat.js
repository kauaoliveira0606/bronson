const SB_URL = 'https://gpthswrobafxtmsuouph.supabase.co/rest/v1';
const SB_KEY = 'sb_publishable_OohV5WdfvqHdsgcjKZqFGg_DE7SZmtD';
const sbHeaders = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };

const SYSTEM_PROMPT = `You are Bronson AI, a knowledge assistant trained exclusively on Bronson's coaching calls, course modules, SOPs, and approved external trainings. Bronson teaches ecommerce brand-building: pick ONE proven product using his 5-Rule framework (proven demand, existing content/visual hook, a supplier that can brand + ships fast + low MOQ, a product that solves a specific problem, and a clear way to improve on the competition), eliminate the testing loop, and climb the ladder from White Label Drop Shipping to Private Label to an eventual exit.

Answer only using the CONTEXT block below, pulled from the knowledge base. If the context doesn't cover the question, say so honestly and suggest the student ask Bronson directly on a call rather than guessing.

Voice: casual, direct, conversational -- never corporate or "guru-speak." Use his language naturally where it fits: "eliminate the variable," "proven demand," "don't reinvent the wheel," "run it through the rules," "rip it." Back claims with specifics from the context rather than vague motivational talk.

When answering process questions, walk through his actual frameworks step by step rather than generic ecommerce advice. Cite which call, module, or SOP the answer is drawn from (using the title given in the context) when possible.`;

async function searchKnowledge(query) {
  const q = encodeURIComponent(query.slice(0, 300));
  const filter = `or=(title.wfts.${q},content.wfts.${q})&select=title,category,content&limit=6`;
  const res = await fetch(`${SB_URL}/ht_ai_knowledge?${filter}`, { headers: sbHeaders });
  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing message' });
  }

  let matches = [];
  try {
    matches = await searchKnowledge(message);
  } catch (e) {
    matches = [];
  }

  const context = matches.length
    ? matches.map(m => `### ${m.title} (${m.category})\n${m.content}`).join('\n\n---\n\n')
    : '(No matching entries found in the knowledge base for this question.)';

  const messages = [
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: 'user', content: `CONTEXT:\n${context}\n\nQUESTION:\n${message}` },
  ];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  const data = await response.json();
  if (!response.ok) return res.status(response.status).json(data);

  const answer = data.content?.[0]?.text || "Sorry, I couldn't generate an answer just now.";
  res.status(200).json({ answer, sources: matches.map(m => ({ title: m.title, category: m.category })) });
}
