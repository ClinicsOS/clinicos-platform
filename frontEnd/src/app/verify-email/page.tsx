"use client";
import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import Cube3D from "@/components/Cube3D";
import FloatingPlus from "@/components/FloatingPlus";
import { IconCheck, IconX, IconLoader2 } from "@tabler/icons-react";

function VerifyEmailContent() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const verify = useMutation({
    mutationFn: async (token: string) => (await api.post("/auth/verify-email", { token })).data,
    onSuccess: () => setState("success"),
    onError: (e) => {
      setState("error");
      setErrorMsg(errMsg(e, t("ve.errorGeneric")));
    },
  });

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setState("error");
      setErrorMsg(t("ve.noToken"));
      return;
    }
    verify.mutate(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-hero p-4">
      <FloatingPlus style={{ top: "12%", left: "10%" }} />
      <FloatingPlus style={{ bottom: "10%", right: "12%" }} delay={2} />

      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Cube3D size={30} />
          <span className="text-lg font-medium text-[color:var(--hero-text)]">ClinicOS</span>
        </div>

        <div className="rounded-2xl border border-edge bg-black/10 p-8 backdrop-blur-sm">
          {state === "loading" && (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sky/20 text-sky">
                <IconLoader2 size={28} className="animate-spin" />
              </div>
              <h1 className="text-lg font-medium text-[color:var(--hero-text)]">
                {t("ve.loading")}
              </h1>
              <p className="mt-2 text-[11px] text-[color:var(--hero-text-mute)]">
                {t("ve.loadingSub")}
              </p>
            </>
          )}

          {state === "success" && (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal/20 text-teal">
                <IconCheck size={28} />
              </div>
              <h1 className="text-lg font-medium text-[color:var(--hero-text)]">
                {t("ve.successTitle")}
              </h1>
              <p className="mt-2 text-[11px] text-[color:var(--hero-text-mute)]">
                {t("ve.successBody")}
              </p>
              <Link
                href="/dashboard"
                className="mt-5 inline-block rounded-lg bg-teal px-5 py-2.5 text-sm font-medium text-navy hover:brightness-110"
              >
                {t("ve.goToDashboard")}
              </Link>
            </>
          )}

          {state === "error" && (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20 text-red-400">
                <IconX size={28} />
              </div>
              <h1 className="text-lg font-medium text-[color:var(--hero-text)]">
                {t("ve.errorTitle")}
              </h1>
              <p className="mt-2 text-[11px] text-[color:var(--hero-text-mute)]">{errorMsg}</p>
              <div className="mt-5 flex flex-col gap-2">
                <Link
                  href="/dashboard"
                  className="rounded-lg bg-sky px-5 py-2 text-xs font-medium text-white hover:brightness-110"
                >
                  {t("ve.goToDashboard")}
                </Link>
                <Link
                  href="/signin"
                  className="text-[11px] text-[color:var(--hero-text-mute)] hover:text-sky"
                >
                  {t("fp.backToSignin")}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-hero" />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
