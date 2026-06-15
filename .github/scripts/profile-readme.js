const fs = require('fs');
const https = require('https');
const USER = 'ATOMASHOFF';
const TOKEN = process.env.GITHUB_TOKEN || '';

function fetch(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: url,
      headers: {
        'User-Agent': 'profile-readme-updater',
        'Accept': 'application/vnd.github.v3+json',
        ...(TOKEN ? { 'Authorization': `token ${TOKEN}` } : {}),
      },
    };
    https.get(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function pinCard(owner, repo) {
  return `<a href="https://github.com/${owner}/${repo}">
  <img src="https://github-readme-stats.vercel.app/api/pin/?username=${owner}&repo=${repo}&theme=dark&bg_color=161b22&hide_border=true&title_color=7c8bff&icon_color=7c8bff&text_color=c9d1d9" alt="${repo}" width="100%"/>
</a>`;
}

function tableRow(left, right) {
  return `<tr>
  <td align="center" width="50%">${left}</td>
  <td align="center" width="50%">${right}</td>
</tr>`;
}

(async () => {
  // Fetch own repos sorted by stars
  const allRepos = await fetch(`/users/${USER}/repos?per_page=100&sort=updated`);
  const ownRepos = allRepos.filter(r => !r.fork);
  ownRepos.sort((a, b) => b.stargazers_count - a.stargazers_count || new Date(b.updated_at) - new Date(a.updated_at));

  // Fetch events to find contributed repos
  const events = await fetch(`/users/${USER}/events?per_page=300`);
  const contribSet = new Set();
  for (const e of events) {
    if (e.repo) {
      const r = e.repo.name;
      const [owner] = r.split('/');
      if (owner !== USER) contribSet.add(r);
    }
  }

  // Build featured repos section (top 4 own)
  const featured = ownRepos.slice(0, 4);
  let featuredMd = '<!-- featured:start -->\n<table>\n';
  for (let i = 0; i < featured.length; i += 2) {
    const left = pinCard(USER, featured[i].name);
    const right = i + 1 < featured.length ? pinCard(USER, featured[i + 1].name) : '<div></div>';
    featuredMd += tableRow(left, right) + '\n';
  }
  featuredMd += '</table>\n<!-- featured:end -->';

  // Build contributions section (all contributed repos)
  const contribList = Array.from(contribSet);
  let contribMd = '<!-- contributions:start -->\n<table>\n';
  for (let i = 0; i < contribList.length; i += 2) {
    const [owner, repo] = contribList[i].split('/');
    const left = pinCard(owner, repo);
    const right = i + 1 < contribList.length
      ? pinCard(...contribList[i + 1].split('/'))
      : '<div></div>';
    contribMd += tableRow(left, right) + '\n';
  }
  contribMd += '</table>\n<!-- contributions:end -->';

  // Fetch quantified contribution stats
  const mergedPRs = await fetch(`/search/issues?q=author:${USER}+is:pr+is:merged&per_page=1`);
  const totalMergedPRs = mergedPRs.total_count || 0;
  const issues = await fetch(`/search/issues?q=author:${USER}+is:issue&per_page=1`);
  const totalIssues = issues.total_count || 0;
  const reviews = await fetch(`/search/issues?q=reviewed-by:${USER}+type:pr&per_page=1`);
  const totalReviews = reviews.total_count || 0;

  // Count events for recent activity stats
  let recentPRs = 0, recentIssues = 0, recentReviews = 0, recentPushes = 0;
  for (const e of events) {
    if (e.type === 'PullRequestEvent' && e.payload?.action === 'closed' && e.payload?.pull_request?.merged) recentPRs++;
    else if (e.type === 'PullRequestEvent' && e.payload?.action === 'opened') recentPRs++;
    else if (e.type === 'IssuesEvent' && e.payload?.action === 'opened') recentIssues++;
    else if (e.type === 'PullRequestReviewEvent') recentReviews++;
    else if (e.type === 'PushEvent') recentPushes++;
  }

  // Build metrics section
  const metricsMd = `<!-- metrics:start -->
<p align="center">
  <img src="https://img.shields.io/badge/PRs%20Merged-${totalMergedPRs}-7c8bff?style=for-the-badge&logo=github"/>&nbsp;
  <img src="https://img.shields.io/badge/Issues%20Opened-${totalIssues}-7c8bff?style=for-the-badge&logo=github"/>&nbsp;
  <img src="https://img.shields.io/badge/Reviews%20Given-${totalReviews}-7c8bff?style=for-the-badge&logo=github"/>&nbsp;
  <img src="https://img.shields.io/badge/Repos%20Contributed-${contribList.length}-7c8bff?style=for-the-badge&logo=github"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Own%20Repos-${ownRepos.length}-7c8bff?style=for-the-badge&logo=github"/>&nbsp;
  <img src="https://img.shields.io/badge/Total%20Stars-${ownRepos.reduce((a,r)=>a+r.stargazers_count,0)}-7c8bff?style=for-the-badge&logo=github"/>&nbsp;
  <img src="https://img.shields.io/badge/Forks-${ownRepos.reduce((a,r)=>a+r.forks_count,0)}-7c8bff?style=for-the-badge&logo=github"/>
</p>
<!-- metrics:end -->`;

  // Update README.md
  let readme = fs.readFileSync('README.md', 'utf8');
  const pattern = /<!-- featured:start -->[\s\S]*?<!-- featured:end -->/;
  const cpattern = /<!-- contributions:start -->[\s\S]*?<!-- contributions:end -->/;
  const mpattern = /<!-- metrics:start -->[\s\S]*?<!-- metrics:end -->/;

  if (pattern.test(readme)) {
    readme = readme.replace(pattern, featuredMd);
  }
  if (cpattern.test(readme)) {
    readme = readme.replace(cpattern, contribMd);
  }
  if (mpattern.test(readme)) {
    readme = readme.replace(mpattern, metricsMd);
  }

  fs.writeFileSync('README.md', readme);
  console.log('README updated');
  console.log(`Featured repos: ${featured.map(r => r.name).join(', ')}`);
  console.log(`Contributions: ${contribList.join(', ') || 'none found'}`);
  console.log(`PRs merged: ${totalMergedPRs}, Issues: ${totalIssues}, Reviews: ${totalReviews}`);
})();
