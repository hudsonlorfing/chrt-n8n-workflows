# Security Guidelines

## API Keys & Secrets

### ⚠️ NEVER commit these to git:
- API keys (Gemini, OpenAI, Anthropic, etc.)
- Slack webhook URLs
- GitHub Personal Access Tokens
- Database credentials
- Any token starting with `sk-`, `AIza`, `xox`, `ghp_`, etc.

### ✅ How to handle secrets:

1. **Use environment variables**
   ```bash
   # In .env file (gitignored)
   GEMINI_API_KEY=AIza...
   N8N_API_KEY=n8n_...
   ```

2. **Use placeholders in committed files**
   ```json
   {
     "url": "{{ SLACK_WEBHOOK_URL }}"
   }
   ```

3. **Use n8n credentials** for workflow secrets - they're stored encrypted in n8n cloud

### Pre-commit Hook

This repo has a pre-commit hook that scans for secrets before allowing commits.

**Install** (already configured):
```bash
git config core.hooksPath .githooks
```

**Patterns detected:**
- Google/Gemini API keys: `AIza...`
- OpenAI keys: `sk-...`
- Slack tokens: `xox[baprs]-...`
- Slack webhooks: `hooks.slack.com/services/...`
- GitHub PATs: `ghp_...`, `gho_...`
- AWS keys: `AKIA...`
- Stripe keys: `sk_live_...`, `sk_test_...`

**Bypass** (use with extreme caution):
```bash
git commit --no-verify
```

### If you accidentally commit a secret:

1. **Rotate the key immediately** - assume it's compromised
2. Remove from git history using BFG Repo Cleaner:
   ```bash
   bfg --replace-text passwords.txt
   git push --force
   ```
3. Update the key in all services

### Environment Setup

Required environment variables:
```bash
# .env (create from .env.example)
N8N_API_KEY=         # n8n cloud API key
N8N_BASE_URL=        # https://your-instance.app.n8n.cloud
GEMINI_API_KEY=      # Google Gemini API key
GITHUB_TOKEN=        # For GitHub API access (optional)
```

### VPS Secrets

On the VPS (`srv1230891.hstgr.cloud`), secrets are stored in:
- `/root/n8n-autofix/.env`

Load with:
```bash
source .env && export GEMINI_API_KEY
pm2 restart all --update-env
```

