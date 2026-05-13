import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const features = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/features' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    metaDescription: z.string(),
    icon: z.string(),
    heroTagline: z.string(),
    benefits: z.array(z.object({
      title: z.string(),
      description: z.string(),
    })),
    subTools: z.array(z.object({
      name: z.string(),
      description: z.string(),
    })),
    stats: z.array(z.object({
      value: z.number(),
      suffix: z.string().optional(),
      label: z.string(),
    })).optional(),
    story: z.array(z.object({
      caption: z.string(),
      highlight: z.string(),
    })).optional(),
    faqs: z.array(z.object({
      question: z.string(),
      answer: z.string(),
    })).optional(),
    opportunities: z.array(z.object({
      icon: z.string(),
      title: z.string(),
      description: z.string(),
    })).optional(),
    useCases: z.array(z.object({
      icon: z.string(),
      audience: z.string(),
      scenario: z.string(),
    })).optional(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    author: z.string().default('Nicolas Gorrono'),
    tags: z.array(z.string()).default([]),
    image: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { features, blog };
