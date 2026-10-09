/** Renders contract wording: "## " lines are headings, blank lines separate paragraphs. */
export function ContractBody({ body }: { body: string }) {
  const blocks = body.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, index) =>
        block.startsWith('## ') ? (
          <h3 key={index} className="pt-3 text-base font-semibold first:pt-0">
            {block.slice(3)}
          </h3>
        ) : (
          <p key={index} className="text-foreground/85">
            {block}
          </p>
        ),
      )}
    </div>
  );
}
