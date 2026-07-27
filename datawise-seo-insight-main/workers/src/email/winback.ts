import { buildSequenceEmail, calloutBlock } from './sequences';

const SKOOL_URL = 'https://www.skool.com/ai-ranking/';

function firstName(name: string): string {
  return name ? name.split(' ')[0] : 'there';
}

// Step 1, sent immediately after the CSV revoke run drops the user back to free.
function getWinbackEmail1(name: string, unsubscribeUrl: string): { subject: string; html: string } {
  const display = firstName(name);
  return {
    subject: "Your DataWise data is saved, here's what changes",
    html: buildSequenceEmail(unsubscribeUrl, {
      preheader: 'Your projects, rank history, and GSC connections stay put. Here is how to pick up where you left off.',
      eyebrow: 'Account update',
      issueLabel: 'Step 1 of 2',
      headline: `Your DataWise data<br /><span class="dw-accent" style="color:#1F7A43;">is saved</span>`,
      byline: 'From Nico, founder, AI Ranking',
      body: `
        Hi ${display},
        <br /><br />
        Your AI Ranking community membership ended, so DataWise dropped back to the free plan on your account. Quick note so there are no surprises.
        <br /><br />
        Nothing got deleted. Everything you built is exactly where you left it:
        ${calloutBlock('What stays on your account', `
          <ul style="margin:0; padding-left:18px;">
            <li>Your projects and tracked properties</li>
            <li>Every keyword rank snapshot you have collected</li>
            <li>Connected Google Search Console accounts and synced data</li>
            <li>Saved competitor lists, gap analyses, and reports</li>
          </ul>
        `)}
        What the free plan looks like in practice:
        ${calloutBlock("What's paused on the free plan", `
          <ul style="margin:0; padding-left:18px;">
            <li>Daily rank tracking pauses (history stays, new snapshots stop)</li>
            <li>Tool runs cap at 5 across keyword research, competitor, AI visibility</li>
            <li>SEO Assistant chat is paused</li>
            <li>GSC data stops auto-syncing</li>
          </ul>
        `)}
        If you want to flip everything back on, rejoining the community restores access right away. Same login, same projects, same data.
        <br /><br />
        If life took you somewhere else, no hard feelings. Reply and tell me what didn't click. That feedback is how the product gets better.
        <br /><br />
        Nico
      `,
      postscript: "p.s. your data isn't going anywhere, take your time.",
      buttons: [{ label: 'Rejoin AI Ranking →', url: SKOOL_URL, variant: 'primary' }],
      trustLine: `<span style="color:#1F7A43; font-weight:700;">✓</span>&nbsp;&nbsp;Same login <span style="opacity:0.4; padding:0 6px;">·</span> Projects intact <span style="opacity:0.4; padding:0 6px;">·</span> Cancel any time`,
    }),
  };
}

// Step 2, sent 14 days after step 1 if the user has not rejoined.
function getWinbackEmail2(name: string, unsubscribeUrl: string): { subject: string; html: string } {
  const display = firstName(name);
  return {
    subject: 'What unlimited DataWise costs vs. Ahrefs and Semrush',
    html: buildSequenceEmail(unsubscribeUrl, {
      preheader: '$27 vs $129+, plus what you can run any week of the year.',
      eyebrow: 'The math on rejoining',
      issueLabel: 'Step 2 of 2',
      headline: `Unlimited DataWise<br />at <span class="dw-accent" style="color:#1F7A43;">$27 a month</span>`,
      byline: 'From Nico, founder, AI Ranking',
      body: `
        Hi ${display},
        <br /><br />
        Quick check-in. Your DataWise account is still on free, projects intact. Two angles that might change the calculus on rejoining.
        <br /><br />
        First, the pricing math:
        ${calloutBlock("What you'd pay elsewhere", `
          <ul style="margin:0; padding-left:18px;">
            <li>Ahrefs Lite: <strong>$129/mo</strong> (1 user, no AI visibility, no community)</li>
            <li>Semrush Pro: <strong>$139.95/mo</strong> (1 user, no AI visibility, no community)</li>
            <li><strong style="color:#1F7A43;">AI Ranking + DataWise: $27/mo, everything included</strong></li>
          </ul>
        `)}
        Second, what unlimited actually unlocks day to day:
        ${calloutBlock('What you can run any week', `
          <ul style="margin:0; padding-left:18px;">
            <li>Keyword research with no credit anxiety: ideas, suggestions, difficulty, related</li>
            <li>Competitor and gap analysis on any domain, as often as you need it</li>
            <li>AI visibility checks across Google AI, ChatGPT, and Perplexity</li>
            <li>Daily rank tracking on every keyword you care about</li>
            <li>SEO Assistant chat that sits on top of your own data</li>
          </ul>
        `)}
        And the part the tools alone don't cover:
        ${calloutBlock("What the community adds", `
          <ul style="margin:0; padding-left:18px;">
            <li>Direct access to me when something in the data doesn't add up</li>
            <li>Weekly threads on what is actually moving in SERPs and AI Overviews</li>
            <li>GEO playbooks as AI search keeps reshaping the game</li>
            <li>Other operators to gut-check ideas with, no fluff</li>
          </ul>
        `)}
        Your projects, tracked keywords, and rank history are still on your account exactly as you left them. One click puts them back in motion.
        <br /><br />
        Nico
      `,
      buttons: [{ label: 'Rejoin and pick up where I left off →', url: SKOOL_URL, variant: 'primary' }],
    }),
  };
}

export function getWinbackEmail(
  step: number,
  name: string,
  unsubscribeUrl: string
): { subject: string; html: string } | null {
  switch (step) {
    case 1: return getWinbackEmail1(name, unsubscribeUrl);
    case 2: return getWinbackEmail2(name, unsubscribeUrl);
    default: return null;
  }
}
