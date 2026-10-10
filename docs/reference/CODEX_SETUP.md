# Codex setup verification

Reviewed 4 October 2026 using official OpenAI documentation and local CLI help. Installed CLI
reported version 0.160.0. No global Codex configuration was edited.

The workspace uses root AGENTS.md, native standalone .codex/agents/*.toml and repository
.agents/skills/<name>/SKILL.md. Each role file has name, description and developer_instructions;
workers use read-only mode. Project config permits two concurrent child agents and inherits
model selection. Skills have name/description frontmatter and focused workflow instructions.

The optional helper uses codex exec flags verified in local help: --ignore-user-config,
--ephemeral, --sandbox read-only, -C, --json, --output-schema and --output-last-message.
Its one-role run disables nested agents with agents.enabled=false. It may still require
the project trust/account state available on the user's computer. Script preparation and
subprocess-boundary tests do not verify authentication, service availability or model results.

Sources:

- [Project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Native custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Repository skills](https://learn.chatgpt.com/docs/build-skills)
- [Non-interactive runs](https://learn.chatgpt.com/docs/non-interactive-mode)

Prompt instructions and read-only filesystem access have different effects; connector/tool
permissions remain separate. The helper defines no sending/payment connector. Do not assume
every inherited interactive connector is constrained by read-only filesystem settings.

## Dungeon update

The current project has four native residual judgment roles under `.codex/agents/`. The Operations, Finance and fixed Customer definitions are archived in `.codex/retired/`, outside active discovery. All ordinary helper role calls run scripts. Model preparation needs a specific judgment reason and may carry a selected script run’s actual inputs. The website prepares prompts only. No global settings or live account integrations were changed or tested.
