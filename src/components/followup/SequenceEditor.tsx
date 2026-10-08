import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ChatText } from "@/components/chat/ChatText";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  EXAMPLE_SEQUENCE,
  MAX_STEPS,
  type SequenceWithSteps,
  type StepDraft,
  VARIABLES,
  delayLabel,
  renderFollowup,
  useSequences,
} from "./followup";

interface Form {
  id: string | null;
  name: string;
  description: string;
  is_active: boolean;
  trigger: "manual" | "no_reply";
  trigger_after_hours: number;
  label_id: string | null;
  send_hour: number | null;
  ai_personalize: boolean;
  steps: StepDraft[];
}

const NEW_FORM: Form = {
  id: null,
  name: "",
  description: "",
  is_active: true,
  trigger: "manual",
  trigger_after_hours: 24,
  label_id: null,
  send_hour: 9,
  ai_personalize: false,
  steps: [{ delay_days: 1, delay_hours: 0, message: "", template_name: null, template_language: null }],
};

function toForm(s: SequenceWithSteps): Form {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    is_active: s.is_active,
    trigger: s.trigger as Form["trigger"],
    trigger_after_hours: s.trigger_after_hours,
    label_id: s.label_id,
    send_hour: s.send_hour,
    ai_personalize: s.ai_personalize,
    steps: s.followup_steps.map((st) => ({
      delay_days: st.delay_days,
      delay_hours: st.delay_hours,
      message: st.message,
      template_name: st.template_name,
      template_language: st.template_language,
    })),
  };
}

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);

export function SequenceEditor({ orgId, orgName, canEdit }: { orgId: string; orgName: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data: sequences = [] } = useSequences(orgId);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: labels = [] } = useQuery({
    queryKey: ["labels", orgId],
    queryFn: async () => (await supabase.from("labels").select("id, name, color").order("name")).data ?? [],
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["followup-templates", orgId],
    queryFn: async () =>
      (await supabase.from("templates").select("name, language, status").order("name")).data?.filter(
        (t) => !t.status || t.status === "APPROVED",
      ) ?? [],
  });
  const { data: ai } = useQuery({
    queryKey: ["followup-ai-names", orgId],
    queryFn: async () => (await supabase.from("ai_settings").select("bot_name, salutation").maybeSingle()).data,
  });

  // Open the first sequence once loaded.
  useEffect(() => {
    if (!form && sequences.length) setForm(toForm(sequences[0]));
  }, [sequences, form]);

  const preview = useMemo(
    () => (text: string) =>
      renderFollowup(text, { name: "Budi Santoso", salutation: ai?.salutation, agent: "Rina", bot: ai?.bot_name ?? "Asisten", shop: orgName }),
    [ai, orgName],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["followup-sequences", orgId] });

  const setStep = (i: number, patch: Partial<StepDraft>) =>
    setForm((f) => f && { ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveStep = (i: number, by: number) =>
    setForm((f) => {
      if (!f) return f;
      const steps = [...f.steps];
      const [s] = steps.splice(i, 1);
      steps.splice(i + by, 0, s);
      return { ...f, steps };
    });

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) return toast.error("Beri nama urutan follow-up");
    if (!form.steps.length || form.steps.some((s) => !s.message.trim())) return toast.error("Setiap lapis harus berisi pesan");
    setSaving(true);
    try {
      const values = {
        organization_id: orgId,
        name: form.name.trim(),
        description: form.description.trim(),
        is_active: form.is_active,
        trigger: form.trigger,
        trigger_after_hours: form.trigger_after_hours,
        label_id: form.label_id,
        send_hour: form.send_hour,
        ai_personalize: form.ai_personalize,
      };
      const { data: saved, error } = form.id
        ? await supabase.from("followup_sequences").update(values).eq("id", form.id).select().single()
        : await supabase.from("followup_sequences").insert(values).select().single();
      if (error) throw error;
      const { error: delError } = await supabase.from("followup_steps").delete().eq("sequence_id", saved.id);
      if (delError) throw delError;
      const { error: stepError } = await supabase.from("followup_steps").insert(
        form.steps.map((s, i) => ({
          organization_id: orgId,
          sequence_id: saved.id,
          position: i + 1,
          delay_days: s.delay_days,
          delay_hours: s.delay_hours,
          message: s.message.trim(),
          template_name: s.template_name,
          template_language: s.template_language,
        })),
      );
      if (stepError) throw stepError;
      setForm((f) => f && { ...f, id: saved.id });
      toast.success("Urutan follow-up disimpan");
      refresh();
    } catch (err) {
      const msg = errorMessage(err);
      toast.error(msg.includes("followup_sequences_organization_id_name_key") ? "Nama urutan sudah dipakai" : msg);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!form?.id || !window.confirm(`Hapus urutan "${form.name}"? Follow-up yang sedang berjalan ikut berhenti.`)) return;
    const { error } = await supabase.from("followup_sequences").delete().eq("id", form.id);
    if (error) return toast.error(errorMessage(error));
    setForm(null);
    refresh();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="space-y-2">
        {sequences.map((s) => (
          <button
            key={s.id}
            onClick={() => setForm(toForm(s))}
            className={cn(
              "w-full rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:bg-muted",
              form?.id === s.id && "border-primary ring-1 ring-primary",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{s.name}</span>
              {!s.is_active && <Badge variant="secondary">Nonaktif</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {s.followup_steps.length} lapis · {s.trigger === "no_reply" ? `otomatis setelah ${s.trigger_after_hours} jam diam` : "dimulai manual"}
            </p>
          </button>
        ))}
        {canEdit && (
          <div className="flex flex-col gap-2 pt-1">
            <Button variant="outline" onClick={() => setForm({ ...NEW_FORM })}>
              <Plus className="mr-1 h-4 w-4" /> Urutan baru
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setForm({
                  ...NEW_FORM,
                  name: sequences.some((s) => s.name === EXAMPLE_SEQUENCE.name) ? `${EXAMPLE_SEQUENCE.name} (2)` : EXAMPLE_SEQUENCE.name,
                  description: EXAMPLE_SEQUENCE.description,
                  steps: EXAMPLE_SEQUENCE.steps.map((s) => ({ ...s })),
                })
              }
            >
              <Sparkles className="mr-1 h-4 w-4" /> Pakai contoh 7 lapis
            </Button>
          </div>
        )}
        {!sequences.length && !canEdit && <p className="text-sm text-muted-foreground">Belum ada urutan follow-up.</p>}
      </div>

      {form ? (
        <Card>
          <CardHeader>
            <CardTitle>{form.id ? "Ubah urutan follow-up" : "Urutan follow-up baru"}</CardTitle>
            <CardDescription>
              Pesan dikirim satu per satu sesuai jeda. Begitu pelanggan membalas, urutan berhenti otomatis dan tercatat
              "membalas setelah lapis ke-…".
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <fieldset disabled={!canEdit} className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="fu-name">Nama urutan</Label>
                  <Input id="fu-name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fu-desc">Keterangan</Label>
                  <Input id="fu-desc" value={form.description} maxLength={300} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label>Cara mulai</Label>
                  <Select value={form.trigger} onValueChange={(v) => setForm({ ...form, trigger: v as Form["trigger"] })}>
                    <SelectTrigger aria-label="Cara mulai">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual (agen memilih di chat)</SelectItem>
                      <SelectItem value="no_reply">Otomatis saat pelanggan diam</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.trigger === "no_reply" && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="fu-after">Mulai setelah pelanggan diam (jam)</Label>
                      <Input
                        id="fu-after"
                        type="number"
                        min={1}
                        max={720}
                        value={form.trigger_after_hours}
                        onChange={(e) => setForm({ ...form, trigger_after_hours: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Hanya chat berlabel</Label>
                      <Select value={form.label_id ?? "all"} onValueChange={(v) => setForm({ ...form, label_id: v === "all" ? null : v })}>
                        <SelectTrigger aria-label="Label">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Semua chat</SelectItem>
                          {labels.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              {l.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
                <div className="space-y-1">
                  <Label>Jam kirim</Label>
                  <Select
                    value={form.send_hour === null ? "any" : String(form.send_hour)}
                    onValueChange={(v) => setForm({ ...form, send_hour: v === "any" ? null : Number(v) })}
                  >
                    <SelectTrigger aria-label="Jam kirim">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Tepat setelah jeda</SelectItem>
                      {HOURS.map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          Pukul {String(h).padStart(2, "0")}.00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.trigger === "no_reply" && (
                <p className="text-xs text-muted-foreground">
                  Chat masuk otomatis bila kita sudah membalas dan pelanggan belum membalas lagi selama {form.trigger_after_hours} jam. Chat yang
                  diam jauh lebih lama dari itu (lebih dari 2 hari setelahnya) tidak diikutkan, agar menyalakan urutan ini tidak mengirim pesan
                  ke semua chat lama.
                </p>
              )}

              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} aria-label="Aktif" />
                  Aktif
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={form.ai_personalize}
                    onCheckedChange={(v) => setForm({ ...form, ai_personalize: v })}
                    aria-label="Disesuaikan AI"
                  />
                  AI menyesuaikan kata-kata dengan isi chat
                </label>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  Variabel:
                  {VARIABLES.map((v) => (
                    <code key={v.key} className="rounded bg-muted px-1.5 py-0.5" title={v.label}>
                      {v.key}
                    </code>
                  ))}
                  <span>· tulis *teks* untuk tebal</span>
                </div>
                {form.steps.map((step, i) => (
                  <div key={i} className="rounded-lg border p-3" data-testid="followup-step">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge>Lapis {i + 1}</Badge>
                      <span className="text-xs text-muted-foreground">Kirim</span>
                      <Input
                        type="number"
                        min={0}
                        max={60}
                        value={step.delay_days}
                        onChange={(e) => setStep(i, { delay_days: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })}
                        className="h-8 w-16"
                        aria-label={`Jeda hari lapis ${i + 1}`}
                      />
                      <span className="text-xs text-muted-foreground">hari</span>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={step.delay_hours}
                        onChange={(e) => setStep(i, { delay_hours: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })}
                        className="h-8 w-16"
                        aria-label={`Jeda jam lapis ${i + 1}`}
                      />
                      <span className="text-xs text-muted-foreground">
                        jam {i === 0 ? "setelah mulai" : "setelah lapis sebelumnya"}
                      </span>
                      <div className="ml-auto flex gap-1">
                        <Button type="button" variant="ghost" size="icon" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label="Naikkan">
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={i === form.steps.length - 1}
                          onClick={() => moveStep(i, 1)}
                          aria-label="Turunkan"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={form.steps.length === 1}
                          onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })}
                          aria-label={`Hapus lapis ${i + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Textarea
                        value={step.message}
                        maxLength={2000}
                        rows={4}
                        onChange={(e) => setStep(i, { message: e.target.value })}
                        placeholder="Halo *{sapaan}*, ..."
                        aria-label={`Pesan lapis ${i + 1}`}
                      />
                      <div className="rounded-lg bg-muted/60 p-3 text-sm">
                        <p className="mb-1 text-[11px] font-medium text-muted-foreground">Contoh untuk pelanggan bernama Budi</p>
                        <p className="whitespace-pre-wrap">
                          <ChatText text={preview(step.message) || "…"} />
                        </p>
                      </div>
                    </div>
                    {templates.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">WhatsApp API, lewat 24 jam pakai template:</span>
                        <Select
                          value={step.template_name ? `${step.template_name}|${step.template_language}` : "none"}
                          onValueChange={(v) => {
                            const [name, language] = v === "none" ? [null, null] : v.split("|");
                            setStep(i, { template_name: name, template_language: language });
                          }}
                        >
                          <SelectTrigger className="h-8 w-auto min-w-[200px]" aria-label={`Template lapis ${i + 1}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Tidak ada (follow-up berhenti bila lewat 24 jam)</SelectItem>
                            {templates.map((t) => (
                              <SelectItem key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                                {t.name} ({t.language})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">{delayLabel(step.delay_days, step.delay_hours, i === 0)}</p>
                  </div>
                ))}
                {form.steps.length < MAX_STEPS && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setForm({
                        ...form,
                        steps: [...form.steps, { delay_days: 1, delay_hours: 0, message: "", template_name: null, template_language: null }],
                      })
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" /> Tambah lapis ({form.steps.length}/{MAX_STEPS})
                  </Button>
                )}
              </div>
            </fieldset>
            {canEdit && (
              <div className="flex gap-2">
                <Button onClick={save} disabled={saving}>
                  Simpan urutan
                </Button>
                {form.id && (
                  <Button variant="ghost" className="text-destructive" onClick={remove}>
                    <Trash2 className="mr-1 h-4 w-4" /> Hapus
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Belum ada urutan follow-up. {canEdit && 'Klik "Pakai contoh 7 lapis" untuk mulai dari kata-kata yang sudah disiapkan.'}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
