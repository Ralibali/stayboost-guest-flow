/** Supabase's default row cap must never hide occupied inventory. */
export async function collectPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error || !data) throw new Error("page_unavailable");
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}
