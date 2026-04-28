const { Octokit } = require("octokit");
const fs = require("fs");
const path = require("path");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function fetchAllRepoLanguages(username) {
  const languageStats = {};

  // Fetch owned repositories
  console.log(`Fetching owned repositories for ${username}...`);
  const ownedRepos = await octokit.paginate(octokit.rest.repos.listForUser, {
    username,
    type: "owner",
    per_page: 100,
  });
  console.log(`Found ${ownedRepos.length} owned repositories.`);

  for (const repo of ownedRepos) {
    console.log(`  Fetching languages for owned repo: ${repo.name}`);
    const languages = await octokit.rest.repos.listLanguages({
      owner: username,
      repo: repo.name,
    });
    for (const [lang, bytes] of Object.entries(languages.data)) {
      if (!languageStats[lang]) {
        languageStats[lang] = { bytes: 0, owned_repos: 0, starred_repos: 0, forked_repos: 0 };
      }
      languageStats[lang].bytes += bytes;
      languageStats[lang].owned_repos += 1;
    }
  }

  // Fetch starred repositories (for the authenticated user)
  console.log(`Fetching starred repositories for authenticated user...`);
  const starredRepos = await octokit.paginate(octokit.rest.activity.listReposStarredByAuthenticatedUser, {
    per_page: 100,
  });
  console.log(`Found ${starredRepos.length} starred repositories.`);

  for (const starredRepo of starredRepos) {
    console.log(`  Fetching languages for starred repo: ${starredRepo.repo.name}`);
    try {
        const languages = await octokit.rest.repos.listLanguages({
            owner: starredRepo.repo.owner.login,
            repo: starredRepo.repo.name,
        });
        for (const [lang, bytes] of Object.entries(languages.data)) {
            if (!languageStats[lang]) {
                languageStats[lang] = { bytes: 0, owned_repos: 0, starred_repos: 0, forked_repos: 0 };
            }
            // Give starred repos a lower weight or just count presence
            languageStats[lang].bytes += bytes * 0.1; // Example: 10% weight for starred
            languageStats[lang].starred_repos += 1;
        }
    } catch (error) {
        console.warn(`    Could not fetch languages for starred repo ${starredRepo.repo.name}. Skipping.`);
    }
  }

  // Fetch forked repositories (public repos owned by the user that are forks)
  console.log(`Fetching forked repositories for ${username}...`);
  const allUserRepos = await octokit.paginate(octokit.rest.repos.listForUser, {
    username,
    type: "public",
    per_page: 100,
  });
  const forkedRepos = allUserRepos.filter(repo => repo.fork);
  console.log(`Found ${forkedRepos.length} forked repositories.`);

  for (const repo of forkedRepos) {
    console.log(`  Fetching languages for forked repo: ${repo.name}`);
    const languages = await octokit.rest.repos.listLanguages({
      owner: username,
      repo: repo.name,
    });
    for (const [lang, bytes] of Object.entries(languages.data)) {
      if (!languageStats[lang]) {
        languageStats[lang] = { bytes: 0, owned_repos: 0, starred_repos: 0, forked_repos: 0 };
      }
      // Give forked repos a moderate weight
      languageStats[lang].bytes += bytes * 0.5; // Example: 50% weight for forked
      languageStats[lang].forked_repos += 1;
    }
  }

  return languageStats;
}

function assignRatings(languageStats) {
  let totalWeightedBytes = 0;
  for (const lang in languageStats) {
    totalWeightedBytes += languageStats[lang].bytes;
  }

  const ratedLanguages = {};
  for (const lang in languageStats) {
    const { bytes, owned_repos, starred_repos, forked_repos } = languageStats[lang];
    const percentage = (bytes / totalWeightedBytes) * 100;
    let rating = 'B'; // Default rating

    // Heuristics for A+/A/B ratings
    if (owned_repos > 0 && percentage > 20) { // Significant contribution in owned repos
      rating = 'A+';
    } else if (owned_repos > 0 && percentage > 5) { // Moderate contribution in owned repos
      rating = 'A';
    } else if (owned_repos > 0 || starred_repos > 5 || forked_repos > 2) { // Some presence in owned, or significant starred/forked
      rating = 'B';
    }
    // Languages with minimal presence will remain B or could be filtered out later.

    ratedLanguages[lang] = {
      percentage: parseFloat(percentage.toFixed(2)),
      rating,
      details: { owned_repos, starred_repos, forked_repos, weighted_bytes: bytes }
    };
  }
  return ratedLanguages;
}

// Placeholder for SVG generation - this will be complex
function generateDonutChartSVG(ratedLanguages) {
  const width = 400;
  const height = 200;
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = 80;
  const innerRadius = 60;

  let svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Ubuntu, Cantarell, Noto Sans, sans-serif">
      <style>
        .lang-label { font: 400 10px "Segoe UI", Ubuntu, Cantarell, Noto Sans, sans-serif; fill: #333; }
        .rating-label { font: 700 12px "Segoe UI", Ubuntu, Cantarell, Noto Sans, sans-serif; }
      </style>
      <g transform="translate(${centerX}, ${centerY})">
  `;

  let currentAngle = 0;
  const colors = [
    "#FF0080", "#007FFF", "#00FF80", "#8000FF", "#FF8000", "#00FFFF", "#FF00FF", "#80FF00",
    "#0080FF", "#FF00FF", "#00FFBF", "#BF00FF", "#FFBF00", "#00FFFF", "#FF00BF", "#BFFF00"
  ];
  let colorIndex = 0;

  const languagesArray = Object.entries(ratedLanguages)
    .sort(([, a], [, b]) => b.percentage - a.percentage); // Sort by percentage descending

  for (const [lang, data] of languagesArray) {
    if (data.percentage === 0) continue;

    const angle = (data.percentage / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;

    const x1 = outerRadius * Math.cos(startAngle * Math.PI / 180);
    const y1 = outerRadius * Math.sin(startAngle * Math.PI / 180);
    const x2 = outerRadius * Math.cos(endAngle * Math.PI / 180);
    const y2 = outerRadius * Math.sin(endAngle * Math.PI / 180);

    const x3 = innerRadius * Math.cos(endAngle * Math.PI / 180);
    const y3 = innerRadius * Math.sin(endAngle * Math.PI / 180);
    const x4 = innerRadius * Math.cos(startAngle * Math.PI / 180);
    const y4 = innerRadius * Math.sin(startAngle * Math.PI / 180);

    const largeArcFlag = angle > 180 ? 1 : 0;

    svg += `
      <path d="M ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x4} ${y4} Z" fill="${colors[colorIndex % colors.length]}"/>
    `;
    currentAngle = endAngle;
    colorIndex++;
  }

  // Add a white circle in the center to create the donut hole
  svg += `<circle cx="0" cy="0" r="${innerRadius - 2}" fill="#fff" />`;

  // Add text labels outside the donut, circularly arranged
  let labelAngle = 0;
  const textRadius = outerRadius + 20; // Distance of labels from center

  for (const [lang, data] of languagesArray) {
    if (data.percentage === 0) continue;

    const midAngle = labelAngle + (data.percentage / 100) * 360 / 2;
    const textX = textRadius * Math.cos(midAngle * Math.PI / 180);
    const textY = textRadius * Math.sin(midAngle * Math.PI / 180);

    const textAnchor = textX > 0 ? 'start' : 'end'; // Align text based on its position
    const offsetY = textY > 0 ? 10 : -5; // Adjust vertical position

    svg += `
      <text x="${textX}" y="${textY + offsetY}" text-anchor="${textAnchor}" class="lang-label">
        ${lang} (${data.percentage}%) <tspan class="rating-label" fill="${getRatingColor(data.rating)}">${data.rating}</tspan>
      </text>
    `;

    labelAngle += (data.percentage / 100) * 360;
  }

  svg += `
      </g>
    </svg>
  `;

  return svg;
}

function getRatingColor(rating) {
    switch (rating) {
        case 'A+': return '#4CAF50'; // Green
        case 'A': return '#2196F3'; // Blue
        case 'B': return '#FFC107'; // Amber
        default: return '#9E9E9E'; // Grey
    }
}


async function main() {
  try {
    const languageStats = await fetchAllRepoLanguages(GITHUB_USERNAME);
    const ratedLanguages = assignRatings(languageStats);

    const jsonOutputPath = path.join(__dirname, '..', 'data', 'tech-stack.json');
    fs.writeFileSync(jsonOutputPath, JSON.stringify(ratedLanguages, null, 2));
    console.log(`Generated ${jsonOutputPath}`);

    const svgOutputPath = path.join(__dirname, '..', 'assets', 'tech-stack.svg');
    const svgContent = generateDonutChartSVG(ratedLanguages);
    fs.writeFileSync(svgOutputPath, svgContent);
    console.log(`Generated ${svgOutputPath}`);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
