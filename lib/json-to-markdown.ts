import type { JSONContent } from "@tiptap/react";

/**
 * Convert TipTap JSONContent to Markdown string.
 */
export function jsonToMarkdown(doc: JSONContent): string {
  if (!doc.content) return "";
  return doc.content.map((node) => nodeToMd(node)).join("\n");
}

function nodeToMd(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMd(node.content) + "\n";

    case "heading": {
      const level = node.attrs?.level ?? 1;
      const prefix = "#".repeat(level);
      return `${prefix} ${inlineToMd(node.content)}\n`;
    }

    case "bulletList":
      return (
        (node.content ?? [])
          .map((li) => listItemToMd(li, "-"))
          .join("\n") + "\n"
      );

    case "orderedList":
      return (
        (node.content ?? [])
          .map((li, i) => listItemToMd(li, `${i + 1}.`))
          .join("\n") + "\n"
      );

    case "taskList":
      return (
        (node.content ?? [])
          .map((li) => {
            const checked = li.attrs?.checked ? "x" : " ";
            const text = li.content
              ? li.content.map((c) => inlineToMd(c.content)).join("")
              : "";
            return `- [${checked}] ${text}`;
          })
          .join("\n") + "\n"
      );

    case "blockquote":
      return (
        (node.content ?? [])
          .map((child) => "> " + nodeToMd(child).trimEnd())
          .join("\n") + "\n\n"
      );

    case "codeBlock": {
      const lang = node.attrs?.language ?? "";
      const code = node.content?.map((c) => c.text ?? "").join("") ?? "";
      return "```" + lang + "\n" + code + "\n```\n";
    }

    case "horizontalRule":
      return "---\n";

    case "image": {
      const src = node.attrs?.src ?? "";
      const alt = node.attrs?.alt ?? "";
      return `![${alt}](${src})\n`;
    }

    default:
      // Fallback: try to extract text
      return inlineToMd(node.content) + "\n";
  }
}

function listItemToMd(li: JSONContent, prefix: string): string {
  const parts = (li.content ?? []).map((child) =>
    nodeToMd(child).trimEnd()
  );
  return `${prefix} ${parts.join("\n  ")}`;
}

function inlineToMd(content?: JSONContent[]): string {
  if (!content) return "";
  return content.map((node) => inlineNodeToMd(node)).join("");
}

function inlineNodeToMd(node: JSONContent): string {
  if (node.type === "hardBreak") return "  \n";

  let text = node.text ?? "";
  if (!text && node.type === "image") {
    return `![${node.attrs?.alt ?? ""}](${node.attrs?.src ?? ""})`;
  }

  const marks = node.marks ?? [];
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        text = `**${text}**`;
        break;
      case "italic":
        text = `*${text}*`;
        break;
      case "strike":
        text = `~~${text}~~`;
        break;
      case "code":
        text = `\`${text}\``;
        break;
      case "underline":
        text = `<u>${text}</u>`;
        break;
      case "link":
        text = `[${text}](${mark.attrs?.href ?? ""})`;
        break;
      case "highlight":
        text = `==${text}==`;
        break;
    }
  }

  return text;
}
