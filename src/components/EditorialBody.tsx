import { Fragment } from "react";
function inline(text: string) {
  return text.split(/(\[[^\]]+\]\((?:https?:\/\/|\/(?!\/))[^\s)]+\))/g).map((part, index) => {
    const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    return match ? (
      <a className="underline underline-offset-4" key={index} href={match[2]}>
        {match[1]}
      </a>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    );
  });
}
export function EditorialBody({
  article,
}: {
  article: { intro: string; sections: { heading: string; content: string }[] };
}) {
  return (
    <div className="text-base leading-8">
      <p className="mb-8 text-lg">{article.intro}</p>
      {article.sections.map((section) => (
        <section className="mt-10" key={section.heading}>
          <h2 className="text-2xl font-semibold leading-tight mb-4">{section.heading}</h2>
          {section.content.split("\n\n").map((block, index) =>
            block.startsWith("- ") ? (
              <ul className="list-disc pl-6 my-5 space-y-2" key={index}>
                {block.split("\n").map((line) => (
                  <li key={line}>{inline(line.replace(/^- /, ""))}</li>
                ))}
              </ul>
            ) : (
              <p className="mb-5" key={index}>
                {inline(block)}
              </p>
            ),
          )}
        </section>
      ))}
    </div>
  );
}
