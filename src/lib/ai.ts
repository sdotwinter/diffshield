import { 
  DocTypeClassification, 
  SemanticDiff, 
  ReviewFinding, 
  PRContext, 
  FileChangeSummary, 
  V2ReviewOutput,
  RiskItem,
  ReviewerChecklistItem,
  V2Verdict,
  PRBodySuggestion,
  SectionChange
} from '../types';

// MiniMax API for AI summaries
const MINIMAX_API_URL = 'https://api.minimax.io/v1/text/chatcompletion_v2';

interface MiniMaxConfig {
  apiKey: string;
  groupId: string;
}

interface CodeFileInfo {
  filename: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/**
 * Generate a rich context prompt for v2 PR review
 */
function buildRichPrompt(
  prContext: PRContext,
  docType: DocTypeClassification,
  semanticDiff: SemanticDiff,
  findings: ReviewFinding[],
  codeFiles: CodeFileInfo[]
): string {
  const { title, body, author, baseRef, headRef } = prContext;
  
  // Build files summary
  const filesChanged = [...codeFiles];
  const filesSummary = filesChanged.length > 0 
    ? filesChanged.map(f => `${f.filename}: +${f.additions}/-${f.deletions}`).join('\n')
    : 'No code files changed';
  
  // Build semantic diff summary
  const diffStats = semanticDiff.stats;
  const sectionChanges = semanticDiff.sections.slice(0, 10).map((s: SectionChange) => {
    if (s.type === 'added') return `+ ${s.newHeading} (added)`;
    if (s.type === 'removed') return `- ${s.oldHeading} (removed)`;
    if (s.type === 'modified') return `~ ${s.newHeading} (modified)`;
    return `» ${s.newHeading} (moved)`;
  }).join('\n');
  
  // Build high-signal findings (errors and warnings, max 10)
  const highSignalFindings = findings
    .filter(f => f.type === 'error' || f.type === 'warning')
    .slice(0, 10)
    .map(f => `[${f.type.toUpperCase()}] ${f.file || 'general'}: ${f.message}`)
    .join('\n');
  
  // Build the rich prompt
  const prompt = `You are an expert code reviewer analyzing a GitHub Pull Request.

## PR Context
- **Title:** ${title}
- **Description:** ${body || '(no description)'}
- **Author:** ${author}
- **Base Branch:** ${baseRef}
- **Head Branch:** ${headRef}
- **Document Type:** ${docType.type} (${Math.round(docType.confidence * 100)}% confidence)

## Changes Summary
- Files Changed: ${filesChanged.length}
- Files: ${filesSummary}

## Semantic Diff Stats
- Sections Added: ${diffStats.added}
- Sections Removed: ${diffStats.removed}
- Sections Modified: ${diffStats.modified}
- Sections Moved: ${diffStats.moved}

## Key Section Changes
${sectionChanges || 'No section-level changes detected'}

## High-Signal Findings (Errors & Warnings)
${highSignalFindings || 'No critical issues found'}

Based on this context, generate a structured PR review with the following JSON format:

{
  "prIntent": "2-3 sentence description of what this PR is trying to accomplish from the author's perspective",
  "changeOverview": "Brief summary of what changed and why it matters",
  "keyRisks": [
    {
      "severity": "high|medium|low",
      "category": "security|breaking|docs|performance|testing",
      "description": "What the risk is",
      "evidence": "Specific line/file that demonstrates the risk",
      "suggestion": "How to address or mitigate this risk"
    }
  ],
  "checklist": [
    {
      "category": "security|docs|testing|performance",
      "item": "Specific checklist item",
      "priority": "required|recommended|optional"
    }
  ],
  "prBodySuggestion": {
    "sections": [
      {
        "heading": "Section heading",
        "content": "Section content"
      }
    ]
  },
  "verdict": {
    "verdict": "approved|changes_requested|commented",
    "confidence": 0.0-1.0,
    "summary": "One sentence verdict summary"
  }
}

Respond ONLY with valid JSON, no additional text.`;

  return prompt;
}

/**
 * Parse AI response into structured V2ReviewOutput
 */
function parseV2Response(aiResponse: string): V2ReviewOutput | null {
  try {
    // Try to extract JSON from response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate required fields
    if (!parsed.prIntent || !parsed.changeOverview || !parsed.verdict) {
      return null;
    }
    
    return {
      prIntent: parsed.prIntent,
      changeOverview: parsed.changeOverview,
      keyRisks: parsed.keyRisks || [],
      checklist: parsed.checklist || [],
      prBodySuggestion: parsed.prBodySuggestion || { sections: [] },
      verdict: {
        verdict: parsed.verdict.verdict || 'commented',
        confidence: parsed.verdict.confidence || 0.5,
        summary: parsed.verdict.summary || '',
      },
    };
  } catch (error) {
    console.error('Failed to parse V2 response:', error);
    return null;
  }
}

/**
 * Generate v2 AI summary with rich context
 */
export async function generateV2Review(
  prContext: PRContext,
  docType: DocTypeClassification,
  semanticDiff: SemanticDiff,
  findings: ReviewFinding[],
  config: MiniMaxConfig,
  codeFiles?: CodeFileInfo[]
): Promise<V2ReviewOutput | null> {
  const { apiKey, groupId } = config;
  
  if (!apiKey || !groupId) {
    return null;
  }
  
  const prompt = buildRichPrompt(prContext, docType, semanticDiff, findings, codeFiles || []);
  
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
        max_tokens: 2000,
      }),
    });
    
    if (!response.ok) {
      console.error('MiniMax API error:', response.status);
      return null;
    }
    
    const data = await response.json() as any;
    const aiResponse = data.choices?.[0]?.message?.content || '';
    
    return parseV2Response(aiResponse);
  } catch (error) {
    console.error('MiniMax error:', error);
    return null;
  }
}

/**
 * Generate v2 PR description suggestion
 */
export async function generateV2PRDescription(
  v2Output: V2ReviewOutput
): Promise<string> {
  const { prBodySuggestion } = v2Output;
  
  if (!prBodySuggestion.sections.length) {
    return '';
  }
  
  const sections = prBodySuggestion.sections
    .map(s => `## ${s.heading}\n\n${s.content}`)
    .join('\n\n');
  
  return sections;
}

/**
 * Legacy function - kept for backward compatibility
 */
export async function generateAISummary(
  docType: DocTypeClassification,
  diff: SemanticDiff,
  findings: { type: string; category: string; message: string }[],
  config: MiniMaxConfig,
  codeFiles?: CodeFileInfo[]
): Promise<string> {
  // Fallback to simple prompt if v2 fails
  try {
    const simplePrompt = `Provide a brief 1-2 sentence summary of this PR change. 
Doc type: ${docType.type}. 
Changes: +${diff.stats.added} added, -${diff.stats.removed} removed, ~${diff.stats.modified} modified.`;
    
    const response = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5',
        messages: [{ role: 'user', content: simplePrompt }],
        groupId: config.groupId,
        temperature: 0.3,
        max_tokens: 50,
      }),
    });
    
    if (!response.ok) {
      return '';
    }
    
    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('MiniMax error:', error);
    return '';
  }
}

/**
 * Legacy function - kept for backward compatibility
 */
export async function generatePRDescription(
  docType: DocTypeClassification,
  diff: SemanticDiff,
  findings: { type: string; category: string; message: string }[],
  config: MiniMaxConfig,
  codeFiles?: CodeFileInfo[]
): Promise<string> {
  return generateAISummary(docType, diff, findings, config, codeFiles);
}
