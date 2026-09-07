import { createFileRoute } from "@tanstack/react-router";
import articles from "@/content/editorial/articles.json";
import { EditorialLayout } from "@/components/EditorialLayout";
import { canonicalUrl } from "@/lib/site-url";
export const Route = createFileRoute("/blogg/")({
  head: () => ({
    meta: [
      { title: "Blogg för små boenden | StayBoost" },
      {
        name: "description",
        content: "Praktiska mallar för gästinformation och dagliga rutiner på små boenden.",
      },
      { name: "robots", content: "index,follow" },
      { property: "og:url", content: canonicalUrl("/blogg") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/blogg") }],
  }),
  component: Blog,
});
function Blog() {
  return (
    <EditorialLayout>
      <h1 className="text-3xl sm:text-4xl font-semibold mb-5">Blogg för små boenden</h1>
      <p className="text-lg leading-8 mb-10">
        Praktiska mallar för gästinformation och dagliga rutiner.
      </p>
      <div className="space-y-8">
        {articles.map((article) => (
          <article key={article.slug} className="rounded-xl border border-[color:var(--line)] p-6">
            <time className="text-sm">{article.publishedDate}</time>
            <h2 className="text-2xl font-semibold my-4">
              <a className="underline" href={`/blogg/${article.slug}`}>
                {article.title}
              </a>
            </h2>
            <p className="leading-7">{article.intro}</p>
          </article>
        ))}
      </div>
    </EditorialLayout>
  );
}
