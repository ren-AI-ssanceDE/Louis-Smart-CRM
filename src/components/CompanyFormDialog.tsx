import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { 
  ChevronDown, Mail, Phone, Smartphone, Globe, Building2 
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Dialog } from "./ui/Dialog";
import { trpc } from "../lib/trpc";
import { cn, formatValidationErrors } from "../lib/utils";
import { CompanySchema } from "../lib/schemas";

interface CompanyFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (id_uuid: string) => void;
}

export const CompanyFormDialog = ({ isOpen, onClose, onSuccess }: CompanyFormDialogProps) => {
  const { t } = useTranslation(["companies", "common", "validation_errors"]);
  const utils = trpc.useContext();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const getErrorMessage = (errorKey: string) => {
    if (!errorKey) return "";
    const possibleKeys = [
      `validation_errors:${errorKey}`,
      `offers:${errorKey}`,
      `common:${errorKey}`,
      `companies:${errorKey}`,
    ];
    for (const key of possibleKeys) {
      const translated = t(key, { defaultValue: "" });
      if (translated && translated !== key) {
        return translated;
      }
    }
    return errorKey;
  };

  // Local state for tracking values
  const [emailValue, setEmailValue] = useState("");
  const [websiteValue, setWebsiteValue] = useState("");
  const [phoneValue, setPhoneValue] = useState("");
  const [mobileValue, setMobileValue] = useState("");

  const createCompanyMutation = trpc.createCompany.useMutation({
    onSuccess: (data) => {
      toast.success(t("companies:save_success", { defaultValue: "Firma erfolgreich erstellt!" }));
      utils.getCompanies.invalidate();
      onSuccess(data.id_uuid);
      onClose();
      // Reset local state
      setEmailValue("");
      setWebsiteValue("");
      setPhoneValue("");
      setMobileValue("");
      setErrors({});
    },
    onError: (err) => {
      toast.error(t("companies:save_error", { defaultValue: "Fehler beim Erstellen der Firma: " }) + formatValidationErrors(err.message, t));
    }
  });

  const sanitizeLigatures = (name: string): string => {
    if (!name) return "";
    return name
      .replace(/\u200B/g, "")
      .replace(/\u0430/g, "a")
      .replace(/\u0455/g, "s")
      .replace(/\u0323/g, "")
      .replace(/\u00ad/g, "")
      .replace(/\xad/g, "");
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors({});
    const formData = new FormData(e.currentTarget);
    
    const rawData = {
      full_legal_name: sanitizeLigatures(formData.get("name") as string),
      tax_vat_id: (formData.get("vat_id") as string) || null,
      tax_number: (formData.get("tax_number") as string) || null,
      responsible_person: (formData.get("responsible_person") as string) || null,
      street: (formData.get("street") as string) || null,
      house_number: (formData.get("house_number") as string) || null,
      city: (formData.get("city") as string) || null,
      postal_code: (formData.get("postal_code") as string) || null,
      country_code: ((formData.get("country") as string) || "DE").toUpperCase(),
      email_address: (formData.get("email") as string) || null,
      email_2: (formData.get("email_2") as string) || null,
      website: (formData.get("website") as string) || null,
      phone_number: (formData.get("phone") as string) || null,
      mobile_number: (formData.get("mobile_number") as string) || null,
      fax_number: (formData.get("fax") as string) || null,
      iban: (formData.get("iban") as string) || null,
      bic_swift: (formData.get("bic_swift") as string) || null,
      leitweg_id: (formData.get("leitweg_id") as string) || null,
      short_code: (formData.get("short_code") as string) || null,
      payment_term: (formData.get("payment_term") as string) || null,
      price_list: (formData.get("price_list") as string) || null,
      language: (formData.get("language") as string) || "de",
      opt_in_marketing: formData.get("opt_in") === "on",
      opt_in_social_media: formData.get("opt_in_social") === "on",
      opt_in_direct_message: formData.get("opt_in_dm") === "on",
      opt_in_sms: formData.get("opt_in_sms") === "on",
      opt_in_phone: formData.get("opt_in_phone") === "on",
      custom_documents: (formData.get("custom_docs") as string) || null,
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_by_identity: "human" as const
    };

    try {
      const validatedData = CompanySchema.parse(rawData);
      createCompanyMutation.mutate(validatedData);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorMap: Record<string, string> = {};
        err.issues.forEach(e => {
          if (e.path[0]) {
            errorMap[e.path[0].toString()] = e.message;
          }
        });
        setErrors(errorMap);
        toast.error(t("validation_errors:please_fill_required_fields", { defaultValue: "Bitte füllen Sie alle Pflichtfelder aus." }));
      }
    }
  };

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={() => {
        onClose();
        setErrors({});
      }} 
      title={t("companies:add_new")}
      size="full"
      noPadding
    >
      <div className="flex flex-col h-full bg-primary-dark max-h-[90vh]">
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-0 min-h-full">
            <div className="lg:col-span-2 p-12 space-y-12 overflow-y-auto">
              
              {/* Section 1: Company Information */}
              <div className="space-y-12">
                <div className="flex items-center gap-3 pb-4 border-b-2 border-white/5">
                  <div className="w-2 h-2 rounded-full bg-accent-orange shadow-[0_0_8px_rgba(255,103,22,0.6)]" />
                  <h4 className="text-sm font-black text-white uppercase tracking-[0.3em] font-display">{t("companies:common.details")}</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                  {/* Row 1 */}
                  <div className="space-y-2 flex flex-col gap-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:name")} <span className="text-accent-orange">*</span></label>
                    <input 
                      name="name" 
                      required 
                      maxLength={255}
                      className={cn(
                        "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all placeholder:text-slate-700",
                        errors.full_legal_name ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-orange/10 focus:border-accent-orange"
                      )}
                      placeholder={t("companies:placeholders.name")}
                    />
                    {errors.full_legal_name && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{getErrorMessage(errors.full_legal_name)}</p>}
                  </div>

                  <div className="space-y-2 flex flex-col gap-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.email")}</label>
                    <div className="relative">
                      <input 
                        type="email" 
                        name="email" 
                        maxLength={255} 
                        value={emailValue}
                        onChange={(e) => setEmailValue(e.target.value)}
                        className={cn(
                          "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all placeholder:text-slate-700",
                          errors.email_address ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-orange/10 focus:border-accent-orange"
                        )}
                      />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600">
                        <Mail size={18} />
                      </span>
                    </div>
                    {errors.email_address && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{getErrorMessage(errors.email_address)}</p>}
                  </div>

                  {/* Row 2 */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 space-y-2 flex flex-col gap-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.street")}</label>
                      <input name="street" maxLength={200} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all placeholder:text-slate-700" />
                    </div>
                    <div className="space-y-2 flex flex-col gap-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.house_number")}</label>
                      <input name="house_number" maxLength={20} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all text-center placeholder:text-slate-700" />
                    </div>
                  </div>

                  <div className="space-y-2 flex flex-col gap-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.website")}</label>
                    <div className="relative">
                      <input 
                        type="url" 
                        name="website" 
                        maxLength={255} 
                        value={websiteValue}
                        onChange={(e) => setWebsiteValue(e.target.value)}
                        className={cn(
                          "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all placeholder:text-slate-700",
                          errors.website ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-orange/10 focus:border-accent-orange"
                        )}
                        placeholder={t("common:placeholders.website", { defaultValue: "https://" })} 
                      />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600">
                        <Globe size={18} />
                      </span>
                    </div>
                    {errors.website && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{getErrorMessage(errors.website)}</p>}
                  </div>

                  {/* Row 3 */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2 flex flex-col gap-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.zip")}</label>
                      <input name="postal_code" maxLength={10} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" />
                    </div>
                    <div className="col-span-2 space-y-2 flex flex-col gap-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:city")}</label>
                      <input name="city" maxLength={100} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all placeholder:text-slate-700" />
                    </div>
                  </div>

                  <div className="space-y-2 flex flex-col gap-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.phone")}</label>
                    <div className="relative">
                      <input 
                        type="tel" 
                        name="phone" 
                        maxLength={50} 
                        value={phoneValue}
                        onChange={(e) => setPhoneValue(e.target.value)}
                        className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" 
                        placeholder={t("common:placeholders.phone", { defaultValue: "+49 123 456789" })}
                      />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600">
                        <Phone size={16} />
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 flex flex-col gap-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.responsible")}</label>
                    <input 
                      name="responsible_person" 
                      maxLength={100} 
                      className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all placeholder:text-slate-700" 
                      placeholder={t("companies:placeholders.responsible")}
                    />
                  </div>

                  <div className="space-y-2 flex flex-col gap-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.mobile")}</label>
                    <div className="relative">
                      <input 
                        type="tel" 
                        name="mobile_number" 
                        maxLength={50} 
                        value={mobileValue}
                        onChange={(e) => setMobileValue(e.target.value)}
                        className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" 
                        placeholder={t("common:placeholders.phone", { defaultValue: "+49 123 456789" })}
                      />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600">
                        <Smartphone size={16} />
                      </span>
                    </div>
                  </div>

                  <div className="col-span-full space-y-6 pt-10 border-t border-white/5">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      <label className="flex items-center gap-4 cursor-pointer group">
                        <div className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            name="opt_in" 
                            className="sr-only peer" 
                          />
                          <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                        </div>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.opt_in_email")}</span>
                      </label>

                      <label className="flex items-center gap-4 cursor-pointer group">
                        <div className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            name="opt_in_phone" 
                            className="sr-only peer" 
                          />
                          <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                        </div>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.opt_in_phone")}</span>
                      </label>

                      <label className="flex items-center gap-4 cursor-pointer group">
                        <div className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            name="opt_in_sms" 
                            className="sr-only peer" 
                          />
                          <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                        </div>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.opt_in_sms")}</span>
                      </label>

                      <label className="flex items-center gap-4 cursor-pointer group">
                        <div className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            name="opt_in_dm" 
                            className="sr-only peer" 
                          />
                          <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                        </div>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.opt_in_dm")}</span>
                      </label>

                      <label className="flex items-center gap-4 cursor-pointer group">
                        <div className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            name="opt_in_social" 
                            className="sr-only peer" 
                          />
                          <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                        </div>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.opt_in_social")}</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Financial Data */}
              <div className="space-y-8">
                <div className="flex items-center gap-3 pb-4 border-b-2 border-white/5">
                  <div className="w-2 h-2 rounded-full bg-accent-blue shadow-[0_0_8px_rgba(0,123,255,0.6)]" />
                  <h4 className="text-sm font-black text-white uppercase tracking-[0.3em] font-display">{t("companies:sections.finance_ident")}</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="space-y-2 flex flex-col gap-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.iban")}</label>
                      <input 
                        name="iban" 
                        maxLength={34} 
                        className={cn(
                          "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all font-mono placeholder:text-slate-700",
                          errors.iban ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-orange/10 focus:border-accent-orange"
                        )}
                        placeholder={t("common:placeholders.iban", { defaultValue: "DE00 0000 0000 ..." })} 
                      />
                      {errors.iban && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{getErrorMessage(errors.iban)}</p>}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.short_code", { defaultValue: "Kürzel" })}</label>
                        <input 
                          name="short_code" 
                          maxLength={50} 
                          className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" 
                        />
                      </div>
                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.bic_swift")}</label>
                        <input 
                          name="bic_swift" 
                          maxLength={11} 
                          className={cn(
                            "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all font-mono placeholder:text-slate-700",
                            errors.bic_swift ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-orange/10 focus:border-accent-orange"
                          )}
                        />
                        {errors.bic_swift && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{getErrorMessage(errors.bic_swift)}</p>}
                      </div>
                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.vat_id")}</label>
                        <input 
                          name="vat_id" 
                          maxLength={20} 
                          className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" 
                        />
                      </div>
                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.tax_number", { defaultValue: "Steuernummer" })}</label>
                        <input 
                          name="tax_number" 
                          maxLength={20} 
                          className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.payment_term")}</label>
                        <div className="relative">
                          <select name="payment_term" defaultValue="14" className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all appearance-none">
                            <option value="14">{t("companies:payment_terms.net_14")}</option>
                            <option value="30">{t("companies:payment_terms.net_30")}</option>
                            <option value="60">{t("companies:payment_terms.net_60")}</option>
                          </select>
                          <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={18} />
                        </div>
                      </div>
                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.price_list")}</label>
                        <input name="price_list" className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all placeholder:text-slate-700" />
                      </div>
                    </div>
                    <div className="space-y-2 flex flex-col gap-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.leitweg_id")}</label>
                      <input name="leitweg_id" className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Sidebar: Side Actions & Notes */}
            <div className="bg-primary-light p-12 space-y-12 border-l border-white/5">
              <div className="space-y-8">
                <div className="flex items-center gap-3 pb-4 border-b border-white/10">
                  <div className="w-2 h-2 rounded-full bg-accent-orange" />
                  <h4 className="text-sm font-black text-white uppercase tracking-[0.3em] font-display">{t("companies:sections.custom")}</h4>
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("companies:fields.custom_docs")}</label>
                  <textarea 
                    name="custom_docs" 
                    rows={10}
                    className="w-full bg-primary-dark border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all resize-none shadow-inner placeholder:text-slate-700"
                    placeholder={t("companies:placeholders.notes")}
                  />
                </div>
              </div>

              <div className="space-y-4 pt-12 mt-12 border-t border-white/10">
                <button 
                  type="submit"
                  disabled={createCompanyMutation.isPending}
                  className="w-full bg-accent-orange text-white py-5 rounded-xl font-black uppercase text-[11px] tracking-[0.2em] hover:bg-accent-orange/90 transition-all shadow-2xl shadow-accent-orange/30 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {createCompanyMutation.isPending && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {createCompanyMutation.isPending ? t("common:loading") : t("common:save")}
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    onClose();
                    setErrors({});
                  }}
                  className="w-full bg-primary-light border-2 border-white/5 text-slate-500 py-5 rounded-xl font-black uppercase text-[11px] tracking-[0.2em] hover:bg-white/5 transition-all active:scale-95"
                >
                  {t("common:cancel")}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </Dialog>
  );
};
