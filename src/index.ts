import express from 'express';
import dotenv from 'dotenv';
import { WebhookPayload, GitHubConfig } from './types';
import { createGitHubClient, handlePullRequest } from './handlers/github';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory stats (use Redis/DB for production)
const stats = {
  installations: new Set<string>(),
  pullRequestsReviewed: 0,
  repositories: new Set<string>(),
  subscriptions: new Map<string, { plan: string; since: Date }>(), // installationId -> {plan, since}
};

// Create webhooks instance - simplified
const config: GitHubConfig = {
  appId: process.env.GITHUB_APP_ID || '',
  privateKey: process.env.GITHUB_PRIVATE_KEY || '',
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  clientId: process.env.GITHUB_CLIENT_ID || '',
  clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
};

// Middleware
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'DiffShield',
    version: '1.0.0',
  });
});

// Stats endpoint (for you to track usage)
app.get('/stats', (req, res) => {
  res.json({
    installations: stats.installations.size,
    pullRequestsReviewed: stats.pullRequestsReviewed,
    repositories: stats.repositories.size,
    subscriptions: stats.subscriptions.size,
  });
});

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const eventType = req.headers['x-github-event'] as string;
  const payload = req.body as WebhookPayload;
  const action = payload.action;
  
  console.log(`Received webhook: ${eventType} - ${action}`);
  
  // Handle GitHub Marketplace events
  if (eventType === 'marketplace_purchase') {
    const marketplaceAction = payload.action;
    console.log(`Marketplace event: ${marketplaceAction}`);
    
    switch (marketplaceAction) {
      case 'purchased':
        const account = (payload as any).marketplace_purchase?.account?.login;
        const plan = (payload as any).marketplace_purchase?.plan?.name;
        const installId = String((payload as any).marketplace_purchase?.account?.id);
        if (account && plan) {
          stats.subscriptions.set(installId, { plan, since: new Date() });
          console.log(`New purchase: ${account} - ${plan}`);
        }
        break;
        
      case 'cancelled':
        const cancelId = String((payload as any).marketplace_purchase?.account?.id);
        stats.subscriptions.delete(cancelId);
        console.log(`Cancelled: ${(payload as any).marketplace_purchase?.account?.login}`);
        break;
        
      case 'changed':
        const changeId = String((payload as any).marketplace_purchase?.account?.id);
        const newPlan = (payload as any).marketplace_purchase?.plan?.name;
        if (newPlan) {
          stats.subscriptions.set(changeId, { plan: newPlan, since: new Date() });
          console.log(`Plan changed: ${(payload as any).marketplace_purchase?.account?.login} - ${newPlan}`);
        }
        break;
    }
    
    return res.json({ ok: true, event: 'marketplace_purchase', action: marketplaceAction });
  }
  
  // Handle installation events (track usage)
  if (eventType === 'installation') {
  if (action === 'created') {
    const installationId = String(payload.installation?.id);
    stats.installations.add(installationId);
    console.log(`New installation: ${installationId}`);
  }
  
  if (action === 'deleted') {
    const installationId = String(payload.installation?.id);
    stats.installations.delete(installationId);
    console.log(`Uninstalled: ${installationId}`);
  }
  
  // Handle pull request events
  if (action === 'opened' || action === 'synchronize') {
    if (!payload.installation) {
      console.log('No installation, skipping...');
      return res.status(200).json({ ok: true });
    }
    
    // Track repository
    if (payload.repository?.fullName) {
      stats.repositories.add(payload.repository.fullName);
    }
    
    try {
      console.log(`Processing PR #${payload.pull_request?.number} in ${payload.repository?.fullName}`);
      
      const github = await createGitHubClient(payload);
      const result = await handlePullRequest(payload, github);
      
      stats.pullRequestsReviewed++;
      console.log(`Review complete: ${result.summary}`);
      res.json({ ok: true, result: result.summary });
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).json({ error: 'Failed to process' });
    }
  } else {
    res.json({ ok: true, action });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`DiffShield listening on port ${PORT}`);
  console.log(`Webhook endpoint: /webhook`);
  console.log(`Stats endpoint: /stats`);
});

export default app;
