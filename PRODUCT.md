# Product

## Register

product

## Users

Code Review Copilot serves internal engineering teams that need dependable GitLab review automation. Primary users are repository maintainers, tech leads, reviewers, and AI platform owners who inspect review history, configure Pi Profiles, and trace why Pi produced a finding.

They usually arrive while a merge request or push review is running, has failed, or produced findings that need triage. Their job is to understand the review path quickly, trust the evidence, and decide whether to retry, adjust Pi Profile configuration, or act on the reported issues.

## Product Purpose

The product turns GitLab code review into a private, auditable Pi + OpenSandbox workflow with isolated Pi execution, GitLab publishing, and DingTalk notification.

Success means reviewers can see what changed, which Pi Profile ran, which sandbox and worktree were used, which findings survived validation, and where the final comments came from without reading raw logs first.

## Brand Personality

Professional, restrained, traceable.

The interface should feel like a serious internal engineering console: calm enough for repeated daily use, precise enough for incident-style diagnosis, and transparent about Pi runtime decisions.

## Anti-references

Avoid marketing-site presentation, decorative AI-purple glow, over-rounded generic dashboards, and cinematic motion that slows down investigation. Avoid hiding operational detail behind vague summaries. Avoid making workflow visualization depend only on color, since users must be able to read status from labels, icons, and structure.

## Design Principles

1. Make the review chain explain itself before the raw material is needed.
2. Treat traceability as the core product value: every issue, Pi Review Run, model, prompt, sandbox session, and workflow node should have an obvious owner and path.
3. Keep visual hierarchy calm and dense enough for engineering work, with clear separation between overview, runtime evidence, and inspection details.
4. Prefer fast, standard controls over bespoke interactions; users are here to diagnose and decide.
5. Surface Pi output, validation outcomes, and runtime errors directly, rather than smoothing them into generic success states.

## Accessibility & Inclusion

Target WCAG AA for product surfaces. Status must not rely on color alone; include text labels and shape or icon differences. Motion should respect reduced-motion settings. Dense logs and workflow panels should maintain readable contrast, keyboard focus visibility, and resilient layouts at smaller viewports.
