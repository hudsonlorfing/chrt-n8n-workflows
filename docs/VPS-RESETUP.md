# VPS Re-setup (New Machine)

Use this checklist when setting up a new machine or re-establishing access to the Hostinger VPS (`srv1230891.hstgr.cloud`). All secrets are loaded from Doppler; we use a dedicated SSH key `hostinger_n8n` for the VPS.

## 1. Install and configure Doppler

```bash
brew install dopplerhq/cli/doppler
doppler login
doppler setup   # Select "chrt" project, "prd" config
```

Ensure Doppler has at least:

- `VPS_HOST` (e.g. `srv1230891.hstgr.cloud`)
- `VPS_PASSWORD` (root password for initial key setup)
- `N8N_API_KEY`
- `N8N_BASE_URL`

Full list: [env.example](env.example).

## 2. Create the dedicated VPS SSH key (if needed)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/hostinger_n8n -C "hostinger-n8n"
```

Store the passphrase in 1Password (e.g. "Hostinger_SSH_New") if you use one.

## 3. Add SSH config

Add this to `~/.ssh/config`:

```
Host hostinger-n8n
    HostName srv1230891.hstgr.cloud
    User root
    Port 22
    IdentityFile ~/.ssh/hostinger_n8n
```

Then connect with: `ssh hostinger-n8n`

## 4. Push your key to the VPS (first time or after VPS reset)

If the VPS does not yet have your public key (or you reimaged the server):

```bash
cd chrt-n8n-workflows
./scripts/legacy/setup-vps-ssh.sh
```

This uses `VPS_HOST` and `VPS_PASSWORD` from Doppler to log in once and append `~/.ssh/hostinger_n8n.pub` to `~/.ssh/authorized_keys` on the VPS. Requires `sshpass` (`brew install sshpass` if needed).

## 5. Verify

```bash
ssh hostinger-n8n "echo OK && hostname"
```

If you use a passphrase, you may need: `ssh-add ~/.ssh/hostinger_n8n` first.

---

## VPS details

| Setting | Value |
|---------|-------|
| Host | srv1230891.hstgr.cloud |
| SSH | `ssh hostinger-n8n` |
| n8n URL | https://srv1230891.hstgr.cloud |
| Services | 3848 auto-fix, 3849 model-selector, 3850 slack-forwarder, 3853 meeting/auto-detect |

See [PROJECT-CLAUDE-AUTOFIX.md](PROJECT-CLAUDE-AUTOFIX.md) for auto-fix and deployment details, and [FIREFLIES-SETUP.md](FIREFLIES-SETUP.md) for Fireflies/VPS services.
