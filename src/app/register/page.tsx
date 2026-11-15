import AuthForm from "@/components/AuthForm.tsx";

export default async function Register({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <AuthForm mode="register" next={(await searchParams).next ?? "/"} />;
}
