import { DocTypeClassification, SemanticDiff } from '../types';

// MiniMax API for AI summaries
const MINIMAX_API_URL = 'https://api.minimax.io/v1/text/chatcompletion_v2';

interface MiniMaxConfig {
  apiKey: string;
  groupId: string;
}

export async function generateAISummary(
  docType: DocTypeClassification,
  diff: SemanticDiff,
  findings: { type: string; category: string; message: string }[],
  config: MiniMaxConfig
): Promise<string> {
  const { apiKey, groupId } = config;
  
  if (!apiKey || !groupId) {
    return '';
  }
  
  const stats = diff.stats;
  const findingSummary = findings
    .filter(f => f.type === 'warning')
    .map(f => f.message)
    .slice(0, 5)
    .join('\n- ');
  
  const prompt = `Write ONE short sentence (max 15 words) summarizing these documentation changes for a developer:

Doc type: ${docType.type}
Changes: +${stats.added} added, -${stats.removed} removed, ~${stats.modified} modified

Example: "Updated installation steps to include new dependency" or "Added pricing tier for enterprise users"
Focus on what changed and why it matters.`;

  try {
    const response = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5',
        messages: [{ role: 'user', content: prompt }],
        groupId: groupId,
        temperature: 0.3,
        max_tokens: 50,
      }),
    });
    
    if (!response.ok) {
      console.error('MiniMax API error:', response.status);
      return '';
    }
    
    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('MiniMax error:', error);
    return '';
  }
}
