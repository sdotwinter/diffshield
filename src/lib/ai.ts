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
  
  const prompt = `You are a documentation review assistant. Summarize this PR's documentation changes in 2-3 sentences for a developer.

Document Type: ${docType.type} (${Math.round(docType.confidence * 100)}% confidence)
Changes: +${stats.added} added, -${stats.removed} removed, ~${stats.modified} modified
${findingSummary ? `Key Findings:\n- ${findingSummary}` : ''}

Write a concise, helpful summary in plain English. Focus on what changed and why it matters.`;

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
        max_tokens: 200,
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
