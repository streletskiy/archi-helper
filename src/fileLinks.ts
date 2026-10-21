// Convert file mentions in prose and inline code into ordinary Markdown links.
// Fenced code, existing links and image sources retain their original meaning.
type Node = { type: string; value?: string; url?: string; children?: Node[] };
const extensions = 'pdf|docx?|xlsx?|csv|tsv|json|jsonl|md|txt|log|ya?ml|xml|html?|png|jpe?g|webp|gif|svg|zip|7z|pln|pla|tpl|bpn|ifc|dwg|dxf|py|js|mjs|cjs|tsx?|css|sql|toml|ini|cfg|sh|ps1|bat|exe|mp[34]|wav';
const extension = new RegExp(`\\.(?:${extensions})$`, 'i');
export const isFileMention = (value: string) => !/[\r\n<>]/.test(value) && !/^https?:/i.test(value) &&
  (/^(?:[a-z]:[\\/]|file:\/\/\/|(?:project|session):\/)/i.test(value) || extension.test(value));
const mentions = new RegExp(String.raw`(?:(?:[a-z]:[\\/]|(?:project|session):\/|file:\/\/\/|[\p{L}\p{N}_@.-]+[\\/])[^\r\n<>"\x60?*|]*?\.(?:${extensions})\b|[\p{L}\p{N}_@.][\p{L}\p{N}_@./\\:%+~()=-]*\.(?:${extensions})\b)`, 'giu');
export function remarkFileLinks() {
  return (tree: Node) => {
    const visit = (parent: Node) => {
      if (!parent.children || ['link', 'image', 'code'].includes(parent.type)) return;
      parent.children = parent.children.flatMap((node): Node[] => {
        if (node.type === 'inlineCode' && node.value && isFileMention(node.value))
          return [{ type: 'link', url: node.value, children: [node] }];
        if (node.type !== 'text' || !node.value) { visit(node); return [node]; }
        const result: Node[] = []; let offset = 0;
        for (const match of node.value.matchAll(mentions)) {
          if (!isFileMention(match[0]) || /[\w@]/u.test(node.value.slice(Math.max(0, match.index! - 1), match.index)) || /https?:\/\/\S*$/i.test(node.value.slice(0, match.index))) continue;
          if (match.index! > offset) result.push({ type: 'text', value: node.value.slice(offset, match.index) });
          result.push({ type: 'link', url: match[0], children: [{ type: 'text', value: match[0] }] });
          offset = match.index! + match[0].length;
        }
        if (!offset) return [node];
        if (offset < node.value.length) result.push({ type: 'text', value: node.value.slice(offset) });
        return result;
      });
    };
    visit(tree);
  };
}
