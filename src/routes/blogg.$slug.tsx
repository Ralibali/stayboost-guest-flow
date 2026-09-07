import { createFileRoute, notFound } from "@tanstack/react-router";
import articles from "@/content/editorial/articles.json";
import { EditorialLayout } from "@/components/EditorialLayout";
import { EditorialBody } from "@/components/EditorialBody";
import { canonicalUrl } from "@/lib/site-url";
export const Route = createFileRoute("/blogg/$slug")({
  loader: ({ params }) => {
    const article = articles.find((a) => a.slug === params.slug);
    if (!article) throw notFound();
    return article;
  },
  head: ({ loaderData: article }) =>
    article
      ? {
          meta: [
            { title: `${article.title} | StayBoost` },
            { name: "description", content: article.metaDescription },
            { name: "robots", content: "index,follow" },
            { property: "og:title", content: article.title },
            { property: "og:description", content: article.metaDescription },
            { property: "og:url", content: canonicalUrl(`/blogg/${article.slug}`) },
            { property: "og:type", content: "article" },
          ],
          links: [{ rel: "canonical", href: canonicalUrl(`/blogg/${article.slug}`) }],
          scripts: [
            {
              type: "application/ld+json",
              children: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "BlogPosting",
                headline: article.title,
                datePublished: article.publishedDate,
                mainEntityOfPage: canonicalUrl(`/blogg/${article.slug}`),
                author: { "@type": "Organization", name: "StayBoost" },
              }).replaceAll("<", "\\u003c"),
            },
          ],
        }
      : { meta: [{ name: "robots", content: "noindex" }] },
  component: BlogPost,
});
function BlogPost() {
  const article = Route.useLoaderData();
  return (
    <EditorialLayout>
      <a href="/blogg" className="underline">
        Alla inlägg
      </a>
      <article>
        <h1 className="text-3xl sm:text-4xl leading-tight font-semibold mt-8 mb-5">
          {article.title}
        </h1>
        <p className="text-sm mb-8">
          <time dateTime={article.publishedDate}>{article.publishedDate}</time> · AI-assisterad
          guide
        </p>
        <EditorialBody article={article} />
        <a className="btn-primary inline-block mt-8" href={article.ctaHref}>
          {article.ctaLabel}
        </a>
      </article>
    </EditorialLayout>
  );
}
