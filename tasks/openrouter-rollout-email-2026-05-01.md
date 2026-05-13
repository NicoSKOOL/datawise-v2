# OpenRouter Rollout Email Draft

Date saved: 2026-05-01

## Main Email

Subject: Action needed: connect your OpenRouter API key in DataWise

Hi {{first_name}},

We are updating how AI models work inside DataWise.

From now on, DataWise will use OpenRouter for AI model access. This means you only need to connect one OpenRouter API key in Settings, instead of managing separate keys for OpenAI, Anthropic, Google, or other providers.

Why we are making this change:

- OpenRouter gives access to a wider range of high-quality models through one key.
- Some newer models are much more financially accessible, which helps keep AI usage costs down without compromising output quality.
- It lets us recommend tested model defaults, like DeepSeek V4 Pro for writing and analysis, while still routing search-grounded tasks to the right model when citations or live research are needed.
- As better or more cost-effective models are released, we can update DataWise faster and guide users toward the best option without rebuilding the whole model setup each time.

What you need to do:

1. Create or log in to your OpenRouter account.
2. Generate an OpenRouter API key.
3. Open DataWise Settings.
4. Paste your OpenRouter key into the AI Model section.
5. Save your settings.

Tutorial: {{openrouter_tutorial_link}}

Once connected, DataWise will use your selected model across AI features such as the SEO Assistant, content tools, and the Content Writer. Some research tasks may still use a search-grounded model automatically so DataWise can find sources and citations correctly.

Our recommended default is DeepSeek V4 Pro because it performed strongly in our testing while keeping costs lower than many premium closed models. You can still choose from other tested models in Settings.

Thanks,

Nicolas
DataWise

## Short In-App Notice

DataWise now uses OpenRouter for AI model access. Add your OpenRouter API key in Settings to keep using AI features. This gives you one key for tested models, lower-cost options, and easier model upgrades over time.

Button: Add OpenRouter key

Secondary link: How to get an OpenRouter key

## Notes Before Sending

- Replace `{{openrouter_tutorial_link}}` with the final tutorial URL.
- Confirm whether to say "from now on" or include a specific deployment date.
- If direct OpenAI/Claude/Gemini keys were used by existing users, add a migration sentence: "Your old provider key will not be reused; please connect OpenRouter instead."
