# Connection guide

The repository page helps a visitor connect its skills to an AI app without needing to understand MCP first. It offers ChatGPT, Claude, Cursor, VS Code, Claude Code, Codex CLI, Gemini CLI and a generic remote-MCP guide.

## Behavior

- Choose an app by its bundled icon and name, without category subtitles. The selector follows the ARIA tabs pattern, including arrow keys, Home and End; at phone widths it scrolls horizontally and keeps the selected app in view.
- Keep the complete mounted endpoint copyable, including origin, ref and path; never append `/mcp`. The manifest determines the example server name when present. Clients with an install link lead with an Add button and put the address and configuration under manual setup.
- Each client has three steps. Desktop screens show the selected preview alongside step buttons. Narrower screens show every step description and its preview in a vertical sequence, without accordion controls. All three previews are server-rendered; CSS controls which are visible, and each visible illustration runs its own loop. Preview titles use the app name, including ChatGPT and Claude.
- The selected step stays selected. Simple click scenes repeat every 3 seconds; typing and sending scenes use 6.4 seconds. There is no player, automatic step advancement, duplicate arrow/dot navigation or explanatory footer. A small Example label identifies the illustration.
- The loop runs only while visible. Hidden pages stop the clock; reduced-motion preferences show a complete static illustration. Switching step, app or language resets the animation. One clock synchronizes the pointer, typing and button states.
- Pointer targets align the cursor tip with the control center, without click rings. Toggle pointers target the switch itself, not its surrounding settings row. Text fields demonstrate typing without a pointer effect.
- English and Korean packs supply instructions and screen labels. Localized menus use their names without English parentheticals. Commands, file paths and native menu identifiers without a verified translation remain unchanged.
- Illustrated app controls do not operate the actual app, and their text remains selectable. Commands, editor configurations, form values and example messages also offer click-to-select-and-copy using the complete value, even during typing. Interaction reveals stable text until both focus and selection leave it, so looping animation cannot clear the selection. Shell launch commands and in-app slash commands are separate copy targets. Keyboard activation works, copy success is announced, and clipboard failure leaves the text selected for manual copying. Instructions remain present in server-rendered HTML; browser APIs are used only in effects and event handlers.
- Cursor and VS Code have prominent Add buttons opening their native install confirmation. ChatGPT and Claude offer app-open links to the page where their first step starts; they do not imply an undocumented installation API. Terminal clients show a copyable command. A generic client has no assumed universal JSON schema.
- A step says only what the app asks of the visitor. Claude brings an added connector into a chat on its own, so its last step is a message and nothing is switched on per conversation; ChatGPT still needs the plugin mentioned with @ in a Work chat.
- Finish with a copyable first message naming the repository. No scene claims that a real connection has succeeded. Availability notes and official help explain missing menus without promising account access.
- All assets ship with the application, including icon licenses. No remote images, inline styles, third-party embeds or animation dependencies are needed. Website colors remain dark with one blue accent and the point colour on badges alone; client illustrations and marks use their native colors.

## Setup references

Checked September 30, 2026. Recheck these sources when changing the steps, because client menus change independently of this project, and check the app itself where a help article lags behind it: Claude's connectors live on the Customize page (sidebar, or account menu → Settings → Connectors) with an Add menu whose entry is Add custom connector, and the dialog asks for a name and the MCP server URL and ends with Continue, while the help article still describes a + button and a per-chat toggle.

| Client | Official reference |
|---|---|
| ChatGPT | [Connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt), [quickstart](https://developers.openai.com/plugins/quickstart) |
| Claude | [Custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) |
| Cursor | [MCP setup](https://cursor.com/help/customization/mcp), [install links](https://cursor.com/docs/mcp/install-links) |
| VS Code | [MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) |
| Claude Code | [MCP](https://code.claude.com/docs/en/mcp) |
| Codex CLI | [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) |
| Gemini CLI | [MCP setup](https://geminicli.com/docs/cli/tutorials/mcp-setup/) |

Icon provenance and redistribution notices are in [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md). These sources establish the setup paths; exact appearance and translated menu wording may differ across versions.

The Korean language pack follows the labels of Claude's Korean interface as the app shows them (the Customize page, its Connectors tab, the Add custom connector entry, the MCP server URL field and the Continue button); its [Korean help article](https://support.claude.com/ko/articles/11175166) lags behind the app. Cursor keeps its documented native menu identifiers where localized labels are not established.
VS Code's labels (the add-server command, the trust dialog, the Chat view and Configure Tools) follow its [official Korean language pack](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-ko/translations/main.i18n.json).
