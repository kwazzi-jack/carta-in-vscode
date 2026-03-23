#!/usr/bin/env bash
set -euo pipefail

# Release script for carta-in-vscode
# Handles: version bump, changelog, commit, tag, package, GitHub release, marketplace publish

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
confirm() { read -rp "$1 [y/N] " ans; [[ "$ans" =~ ^[Yy]$ ]]; }

# --- Pre-flight checks ---

# Tools available
command -v vsce >/dev/null 2>&1 || error "'vsce' not found. Install with: npm i -g @vscode/vsce"
command -v gh   >/dev/null 2>&1 || error "'gh' not found. Install GitHub CLI: https://cli.github.com"

# Working tree must be clean
if [[ -n "$(git status --porcelain)" ]]; then
    echo ""
    git status --short
    echo ""
    error "Working tree is not clean. Commit or stash your changes first."
fi

BRANCH=$(git branch --show-current)

# --- Step 0: Merge open PR if not on main ---

if [[ "$BRANCH" != "main" ]]; then
    info "You are on branch '${BOLD}${BRANCH}${NC}', not main."

    # Check for an open PR for this branch
    PR_URL=$(gh pr view "$BRANCH" --json url,state --jq 'select(.state == "OPEN") | .url' 2>/dev/null || true)

    if [[ -n "$PR_URL" ]]; then
        info "Found open PR: ${BOLD}${PR_URL}${NC}"
        echo ""
        echo -e "  How would you like to merge?"
        echo -e "    ${BOLD}1)${NC} Merge commit"
        echo -e "    ${BOLD}2)${NC} Squash and merge"
        echo -e "    ${BOLD}3)${NC} Rebase and merge"
        echo ""
        read -rp "Choice [1]: " MERGE_CHOICE
        MERGE_CHOICE=${MERGE_CHOICE:-1}

        case "$MERGE_CHOICE" in
            1) MERGE_FLAG="" ;;
            2) MERGE_FLAG="--squash" ;;
            3) MERGE_FLAG="--rebase" ;;
            *) error "Invalid choice." ;;
        esac

        if confirm "Merge PR into main now?"; then
            gh pr merge "$BRANCH" $MERGE_FLAG --delete-branch
            info "PR merged and remote branch deleted."
        else
            error "Release aborted. Merge the PR first, then re-run."
        fi
    else
        error "No open PR found for '${BRANCH}'. Either open a PR or switch to main first."
    fi

    # Switch to main and pull the merge
    info "Switching to main..."
    git checkout main
    git pull origin main --quiet
    info "On main, up to date with origin."
else
    # Already on main — make sure we're in sync
    info "Fetching latest from origin..."
    git fetch origin main --quiet
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)
    if [[ "$LOCAL" != "$REMOTE" ]]; then
        warn "Local main is not in sync with origin/main."
        if ! confirm "Continue anyway?"; then
            exit 1
        fi
    fi
fi

# --- Step 1: Check CHANGELOG.md ---

OLD_VERSION=$(node -p "require('./package.json').version")
info "Current version: ${BOLD}${OLD_VERSION}${NC}"
echo ""

# Determine what the new version will be so we can check the changelog
echo -e "  Select version bump type:"
echo -e "    ${BOLD}1)${NC} patch  ($(echo "$OLD_VERSION" | awk -F. '{printf "%s.%s.%s", $1, $2, $3+1}'))"
echo -e "    ${BOLD}2)${NC} minor  ($(echo "$OLD_VERSION" | awk -F. '{printf "%s.%s.0", $1, $2+1}'))"
echo -e "    ${BOLD}3)${NC} major  ($(echo "$OLD_VERSION" | awk -F. '{printf "%s.0.0", $1+1}'))"
echo ""
read -rp "Choice [1]: " BUMP_CHOICE
BUMP_CHOICE=${BUMP_CHOICE:-1}

case "$BUMP_CHOICE" in
    1) BUMP_TYPE="patch" ;;
    2) BUMP_TYPE="minor" ;;
    3) BUMP_TYPE="major" ;;
    *) error "Invalid choice." ;;
esac

# Calculate the new version without actually bumping yet
case "$BUMP_TYPE" in
    patch) NEW_VERSION=$(echo "$OLD_VERSION" | awk -F. '{printf "%s.%s.%s", $1, $2, $3+1}') ;;
    minor) NEW_VERSION=$(echo "$OLD_VERSION" | awk -F. '{printf "%s.%s.0", $1, $2+1}') ;;
    major) NEW_VERSION=$(echo "$OLD_VERSION" | awk -F. '{printf "%s.0.0", $1+1}') ;;
esac

# Check that CHANGELOG.md has an entry for this version
if ! grep -q "^## \[${NEW_VERSION}\]" CHANGELOG.md; then
    echo ""
    error "CHANGELOG.md has no entry for [${NEW_VERSION}].

  Please update CHANGELOG.md with a section like:

    ## [${NEW_VERSION}] - $(date +%Y-%m-%d)

    ### Added
    - ...

    ### Fixed
    - ...

  Then re-run this task."
fi

info "Found changelog entry for ${BOLD}v${NEW_VERSION}${NC}"
echo ""
echo "---"
sed -n "/^## \[${NEW_VERSION}\]/,/^## \[/{/^## \[${NEW_VERSION}\]/p; /^## \[${NEW_VERSION}\]/!{/^## \[/!p;}}" CHANGELOG.md
echo "---"
echo ""

if ! confirm "Does the changelog look correct?"; then
    error "Update CHANGELOG.md and re-run."
fi

# --- Step 2: Version bump ---

npm version "$BUMP_TYPE" --no-git-tag-version --quiet
info "Bumped version: ${BOLD}${OLD_VERSION}${NC} → ${BOLD}${NEW_VERSION}${NC}"

# --- Step 3: Commit and tag ---

git add package.json CHANGELOG.md
git commit -m "chore: release v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"

info "Created commit and tag ${BOLD}v${NEW_VERSION}${NC}"

# --- Step 4: Push to GitHub ---

if confirm "Push commit and tag to origin?"; then
    git push origin main
    git push origin "v${NEW_VERSION}"
    info "Pushed to GitHub."
else
    warn "Skipped push. You can push later with:"
    echo "  git push origin main && git push origin v${NEW_VERSION}"
fi

# --- Step 5: Create GitHub release (source only, no .vsix) ---

if confirm "Create GitHub release?"; then
    # Extract changelog section for release notes
    RELEASE_NOTES=$(sed -n "/^## \[${NEW_VERSION}\]/,/^## \[/{ /^## \[${NEW_VERSION}\]/d; /^## \[/d; p; }" CHANGELOG.md)

    gh release create "v${NEW_VERSION}" \
        --title "v${NEW_VERSION}" \
        --notes "$RELEASE_NOTES"

    info "GitHub release created (source code attached automatically by GitHub)."
else
    warn "Skipped GitHub release. You can create it later with:"
    echo "  gh release create v${NEW_VERSION} --title \"v${NEW_VERSION}\""
fi

# --- Step 6: Publish to VS Code Marketplace ---

if confirm "Publish to VS Code Marketplace?"; then
    vsce publish
    info "Published to VS Code Marketplace."
else
    warn "Skipped marketplace publish. You can publish later with:"
    echo "  vsce publish"
fi

# --- Done ---

echo ""
echo -e "${GREEN}${BOLD}Release v${NEW_VERSION} complete!${NC}"
