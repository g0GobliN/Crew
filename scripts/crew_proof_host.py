#!/usr/bin/env python3
"""A stand-in for the plugin host's context, for the proofs that call the plugin's register().

One stub, so a registration surface the plugin grows (register_tool came with the `crew` toolset in 0.9.13)
is added here once instead of in every proof's own copy. Signatures mirror Hermes's PluginContext
(hermes_cli/plugins.py: register_tool, register_command, register_skill, register_hook).
"""


class Host:
    def __init__(self):
        self.commands, self.skills, self.hooks, self.tools = {}, [], [], {}

    def register_command(self, name, handler, description="", args_hint="", **kw):
        self.commands[name] = {"handler": handler, "description": description, "args_hint": args_hint}

    def register_skill(self, name, path=None, description="", frontmatter=None, **kw):
        self.skills.append(name)

    def register_hook(self, name, fn):
        self.hooks.append(name)

    def register_tool(self, name, toolset, schema, handler, check_fn=None, requires_env=None,
                      is_async=False, description="", emoji="", override=False):
        self.tools[name] = {"toolset": toolset, "schema": schema, "handler": handler,
                            "check_fn": check_fn, "description": description}
