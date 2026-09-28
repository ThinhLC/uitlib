import { redirect } from "next/navigation";

export default async function ReaderDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/desk/readers/${id}`);
}
