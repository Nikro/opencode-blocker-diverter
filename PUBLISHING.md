# Publishing Guide

This document explains how to publish new versions of `opencode-blocker-diverter` to npm.

## Publishing Strategy

This package uses **Trusted Publishing** (OIDC) via GitHub Actions for secure, automated releases.

## Setup (One-Time Configuration)

### 1. Configure npm Trusted Publishing ⭐ CRITICAL STEP

**This is what makes tokenless publishing work:**

1. Go to: https://www.npmjs.com/package/opencode-blocker-diverter/access
2. Look for section labeled:
   - "Publishing access" OR
   - "Automation tokens" OR
   - "Provenance" OR
   - "Trusted publishers"
3. Click **"Add a publishing method"** or **"Configure GitHub Actions"**
4. Fill in:
   - **Provider**: GitHub Actions
   - **Repository**: `Nikro/opencode-blocker-diverter`
   - **Workflow**: `.github/workflows/publish.yml`
   - **Environment** (optional): Leave empty or use `npm-publish`
5. Click "Add" or "Save"

**What this does**: npm will now accept cryptographic proof from GitHub Actions instead of requiring a token. NO secrets needed in GitHub!

### 2. ~~Add npm Token to GitHub Secrets~~ NOT NEEDED! ✅

**With Trusted Publishing configured above, you don't need ANY token in GitHub.**

The workflow uses OpenID Connect (OIDC) to prove its identity. No long-lived credentials stored anywhere.

### 3. Optional: Add GitHub Environment Protection

For extra security, create a protected environment:

1. Go to: https://github.com/Nikro/opencode-blocker-diverter/settings/environments
2. Click "New environment"
3. Name: `npm-publish`
4. Configure protection rules:
   - ✅ **Required reviewers**: Add yourself (manual approval before publish)
   - ✅ **Wait timer**: 5 minutes (gives time to cancel accidental releases)
5. Save

Then update the workflow to use this environment:
```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: npm-publish  # Add this line
    permissions:
      contents: read
      id-token: write
```

## How to Publish a New Version

### Step 1: Prepare the Release

```bash
# 1. Update version in package.json
bun version patch  # or 'minor' or 'major'

# 2. Update CHANGELOG.md with changes

# 3. Commit and push
git add package.json CHANGELOG.md
git commit -m "chore: bump version to $(node -p "require('./package.json').version")"
git push origin main
```

### Step 2: Create GitHub Release

```bash
# 1. Create and push tag
VERSION=$(node -p "require('./package.json').version")
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin "v${VERSION}"

# 2. Create release on GitHub
gh release create "v${VERSION}" \
  --title "v${VERSION}" \
  --notes-file CHANGELOG.md \
  --latest
```

Or manually via GitHub UI:
1. Go to: https://github.com/Nikro/opencode-blocker-diverter/releases/new
2. Choose tag: `v0.2.0` (or create new)
3. Title: `v0.2.0`
4. Description: Copy from CHANGELOG.md
5. Click "Publish release"

### Step 3: Workflow Runs Automatically

The GitHub Actions workflow will:
1. ✅ Checkout code
2. ✅ Install Bun + dependencies
3. ✅ Run test suite
4. ✅ Build package
5. ✅ Publish to npm with provenance attestation
6. ✅ Generate supply chain attestation

Watch progress at: https://github.com/Nikro/opencode-blocker-diverter/actions

### Step 4: Verify Publication

```bash
npm view opencode-blocker-diverter

# Check provenance (proves it came from your GitHub repo)
npm view opencode-blocker-diverter --json | jq .dist.attestations
```

## Manual Publishing (Local Machine)

**⚠️ Not recommended** - Use GitHub Actions for security and auditability.

If you absolutely must publish locally:

```bash
# 1. Ensure you have bypass-enabled token in ~/.npmrc
echo "//registry.npmjs.org/:_authToken=npm_xxx" > ~/.npmrc
chmod 600 ~/.npmrc

# 2. Publish
npm publish

# 3. Revoke token afterwards (security best practice)
# Go to: https://www.npmjs.com/settings/nikro/tokens
```

## Security Benefits of This Setup

✅ **No long-lived tokens in code** - Authentication via cryptographic proof  
✅ **Provenance attestation** - Users can verify package came from your GitHub repo  
✅ **Supply chain transparency** - Audit trail from commit → package  
✅ **Protected releases** - Optional manual approval before publish  
✅ **Automatic revocation** - Publish credentials expire after workflow completes  

## Troubleshooting

### Workflow fails with "permission denied"
- Check that `id-token: write` permission is in workflow
- Verify npm package is configured to accept GitHub OIDC

### "NPM_TOKEN not found"
- Add token to GitHub repo secrets: https://github.com/Nikro/opencode-blocker-diverter/settings/secrets/actions
- Or wait for npm's full OIDC support (no token needed)

### Tests fail in CI but pass locally
- Check that all dependencies are in `package.json` (not just installed globally)
- Verify Bun version compatibility

### Want to test workflow without publishing
- Use `npm publish --dry-run` in workflow temporarily
- Or trigger workflow manually via Actions tab (workflow_dispatch)

## Resources

- npm Trusted Publishing: https://docs.npmjs.com/generating-provenance-statements
- GitHub OIDC: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect
- Provenance verification: https://github.blog/2023-04-19-introducing-npm-package-provenance/
