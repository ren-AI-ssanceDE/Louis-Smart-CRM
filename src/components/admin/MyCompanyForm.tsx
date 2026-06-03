import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, User, Shield, Globe, Mail, Smartphone, CreditCard, Key, Server, Database, Loader2, Upload, Trash2, Image } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { validateIBAN, validateBIC, getBankByIbanAndBic, fetchBankData, getBicByIban } from '../../lib/bankUtils';

export const MyCompanyForm = () => {
  const { t } = useTranslation(['admin', 'common', 'companies', 'contacts']);
  const utils = trpc.useContext();
  const { data: myCompanyData, isLoading: isLoadingMyCompany } = trpc.getMyCompany.useQuery();

  const saveMyCompanyMutation = trpc.saveMyCompany.useMutation({
    onSuccess: () => {
      toast.success(t('my_company.success'));
      utils.getMyCompany.invalidate();
    },
    onError: (err) => {
      toast.error(t('my_company.error') + ': ' + err.message);
    }
  });

  const [ibanError, setIbanError] = useState<string | null>(null);
  const [bicError, setBicError] = useState<string | null>(null);
  const [isValidatingIban, setIsValidatingIban] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [myCompanyForm, setMyCompanyForm] = useState({
    full_legal_name: '',
    short_code: '',
    tax_vat_id: '',
    tax_number: '',
    responsible_person: '',
    street: '',
    house_number: '',
    postal_code: '',
    city: '',
    country_code: 'DE',
    email_address: '',
    email_2: '',
    website: '',
    phone_number: '',
    mobile_number: '',
    fax_number: '',
    first_name: '',
    last_name: '',
    salutation: '',
    gender_identity: '',
    date_of_birth: '',
    region: '',
    iban: '',
    bic_swift: '',
    bank_name: '',
    leitweg_id: '',
    vat_rate: 19,
    currency_code: 'EUR',
    language: 'de',
    invoice_number_prefix: 'RE-',
    invoice_number_year_fixed: true,
    invoice_number_next_seq: 1,
    invoice_number_min_digits: 4,
    logo_url: ''
  });

  useEffect(() => {
    if (myCompanyData) {
      setMyCompanyForm({
        full_legal_name: (myCompanyData.full_legal_name || '')
          .replace(/\u0430/g, 'a')
          .replace(/\u0455/g, 's')
          .replace(/\u200B/g, ''),
        short_code: myCompanyData.short_code || '',
        tax_vat_id: myCompanyData.tax_vat_id || '',
        tax_number: myCompanyData.tax_number || '',
        responsible_person: myCompanyData.responsible_person || '',
        street: myCompanyData.street || '',
        house_number: myCompanyData.house_number || '',
        postal_code: myCompanyData.postal_code || '',
        city: myCompanyData.city || '',
        country_code: myCompanyData.country_code || 'DE',
        email_address: myCompanyData.email_address || '',
        email_2: myCompanyData.email_2 || '',
        website: myCompanyData.website || '',
        phone_number: myCompanyData.phone_number || '',
        mobile_number: myCompanyData.mobile_number || '',
        fax_number: myCompanyData.fax_number || '',
        first_name: myCompanyData.first_name || '',
        last_name: myCompanyData.last_name || '',
        salutation: myCompanyData.salutation || '',
        gender_identity: myCompanyData.gender_identity || '',
        date_of_birth: myCompanyData.date_of_birth || '',
        region: myCompanyData.region || '',
        iban: myCompanyData.iban || '',
        bic_swift: myCompanyData.bic_swift || '',
        bank_name: myCompanyData.bank_name || '',
        leitweg_id: myCompanyData.leitweg_id || '',
        vat_rate: myCompanyData.vat_rate || 19,
        currency_code: myCompanyData.currency_code || 'EUR',
        language: myCompanyData.language || 'de',
        invoice_number_prefix: myCompanyData.invoice_number_prefix || 'RE-',
        invoice_number_year_fixed: myCompanyData.invoice_number_year_fixed !== false,
        invoice_number_next_seq: myCompanyData.invoice_number_next_seq ?? 1,
        invoice_number_min_digits: myCompanyData.invoice_number_min_digits ?? 4,
        logo_url: myCompanyData.logo_url || ''
      });
    }
  }, [myCompanyData]);

  const handleLogoUpload = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(t('my_company.logo_invalid'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('my_company.logo_too_large'));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setMyCompanyForm(prev => ({ ...prev, logo_url: reader.result as string }));
      toast.success(t('my_company.logo_success'));
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleLogoUpload(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleLogoUpload(file);
  };

  const handleRemoveLogo = () => {
    setMyCompanyForm(prev => ({ ...prev, logo_url: '' }));
    toast.info(t('my_company.logo_removed'));
  };

  const handleIbanChange = async (val: string) => {
    // Always update input value instantly for responsive typing
    setMyCompanyForm(prev => ({ ...prev, iban: val }));

    const cleanIBAN = val.replace(/\s+/g, '').toUpperCase();
    if (!cleanIBAN) {
      setIbanError(null);
      setMyCompanyForm(prev => ({ ...prev, bank_name: '' }));
      return;
    }

    const localRes = validateIBAN(cleanIBAN);
    if (!localRes.isValid) {
      setIbanError(localRes.error || t('common:invalid_iban'));
      setMyCompanyForm(prev => ({ ...prev, bank_name: '' }));
      return;
    }

    setIbanError(null);

    // Instant local top-bank resolution (0ms feedback!)
    const localBic = getBicByIban(cleanIBAN);
    if (localBic) {
      setMyCompanyForm(prev => ({
        ...prev,
        bank_name: localRes.bankName || prev.bank_name,
        bic_swift: localBic
      }));
      setBicError(null);
    } else {
      setMyCompanyForm(prev => ({
        ...prev,
        bank_name: localRes.bankName || prev.bank_name
      }));
    }

    setIsValidatingIban(true);
    try {
      const liveData = await utils.client.lookupBank.query({ iban: cleanIBAN });
      if (liveData.valid) {
        setIbanError(null);
        setMyCompanyForm(prev => {
          const updated = {
            ...prev,
            bank_name: liveData.bankName || prev.bank_name,
          };
          if (liveData.bic) {
            updated.bic_swift = liveData.bic;
            setBicError(null);
          }
          return updated;
        });
      } else {
        setIbanError(liveData.error || t('common:invalid_iban'));
        setMyCompanyForm(prev => ({ ...prev, bank_name: '' }));
      }
    } catch (err) {
      setMyCompanyForm(prev => ({
        ...prev,
        bank_name: localRes.bankName || ''
      }));
    } finally {
      setIsValidatingIban(false);
    }
  };

  const handleBicChange = (val: string) => {
    const cleanBIC = val.replace(/\s+/g, '').toUpperCase();
    setMyCompanyForm(prev => {
      const nextForm = { ...prev, bic_swift: val };
      
      if (!cleanBIC) {
        setBicError(null);
        return nextForm;
      }
      
      const res = validateBIC(cleanBIC);
      if (!res.isValid) {
        setBicError(res.error || t('common:invalid_bic'));
      } else {
        setBicError(null);
        const bank = getBankByIbanAndBic(prev.iban, cleanBIC);
        if (bank && bank !== 'Unbekannte Bank') {
          nextForm.bank_name = bank;
        }
      }
      return nextForm;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (myCompanyForm.iban) {
      const cleanIban = myCompanyForm.iban.replace(/\s+/g, '').toUpperCase();
      const res = validateIBAN(cleanIban);
      if (!res.isValid) {
        toast.error(t('my_company.iban_error_prefix') + res.error);
        setIbanError(res.error || t('common:invalid_iban'));
        return;
      }
    }

    if (myCompanyForm.bic_swift) {
      const cleanBic = myCompanyForm.bic_swift.replace(/\s+/g, '').toUpperCase();
      const res = validateBIC(cleanBic);
      if (!res.isValid) {
        toast.error(t('my_company.bic_error_prefix') + res.error);
        setBicError(res.error || t('common:invalid_bic'));
        return;
      }
    }

    const sanitizeLigatures = (name: string): string => {
      if (!name) return name;
      return name
        .replace(/\u200B/g, '')
        .replace(/\u0430/g, 'a')
        .replace(/\u0455/g, 's')
        .replace(/\u0323/g, '')
        .replace(/\u00ad/g, '')
        .replace(/\xad/g, '');
    };

    saveMyCompanyMutation.mutate({
      ...myCompanyForm,
      full_legal_name: sanitizeLigatures(myCompanyForm.full_legal_name),
      id_uuid: myCompanyData?.id_uuid || undefined
    });
  };

  if (isLoadingMyCompany) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="text-accent-orange animate-spin" size={40} />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-12">
      {/* Basic Info */}
      <div className="space-y-8">
        <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.3em] font-display border-b border-white/5 pb-2">{t('my_company.identity_context')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Logo Upload Region */}
          <div className="md:col-span-2 space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.logo_label')}</label>
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-8 flex flex-col md:flex-row items-center gap-8 justify-between transition-all relative overflow-hidden ${
                isDragging 
                  ? 'border-accent-orange bg-accent-orange/10' 
                  : 'border-white/10 bg-primary-dark/40 hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-6">
                {myCompanyForm.logo_url ? (
                  <div className="w-24 h-24 rounded-2xl bg-white p-2 flex items-center justify-center shadow-2xl relative group overflow-hidden border border-slate-100">
                    <img 
                      src={myCompanyForm.logo_url} 
                      alt="Company Logo Preview" 
                      className="max-w-full max-h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="p-2 rounded-full bg-red-500/80 hover:bg-red-600 text-white transition-all shadow-lg"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-2xl bg-primary-dark border border-white/5 flex items-center justify-center text-slate-600 shadow-inner">
                    <Image size={32} />
                  </div>
                )}
                
                <div className="text-left space-y-1">
                  <p className="text-white font-bold text-sm">
                    {myCompanyForm.logo_url ? t('my_company.logo_loaded') : t('my_company.logo_upload')}
                  </p>
                  <p className="text-slate-500 text-xs font-medium">
                    {t('my_company.logo_drag_drop')}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <input 
                  type="file" 
                  id="logo-input" 
                  accept="image/png, image/jpeg, image/jpg" 
                  onChange={handleFileInputChange} 
                  className="hidden" 
                />
                <label 
                  htmlFor="logo-input"
                  className="px-6 py-3 rounded-xl bg-primary-light border border-white/10 text-white font-bold text-[10px] uppercase tracking-widest hover:bg-primary-light/80 transition-all cursor-pointer font-display"
                >
                  {t('my_company.browse')}
                </label>
                {myCompanyForm.logo_url && (
                  <button 
                    type="button"
                    onClick={handleRemoveLogo}
                    className="px-6 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 font-bold text-[10px] uppercase tracking-widest hover:bg-red-500/20 transition-all font-display"
                  >
                    {t('my_company.delete')}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.company_name')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Building2 size={20} className="text-slate-700" />
              <input 
                type="text" 
                required
                value={myCompanyForm.full_legal_name}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, full_legal_name: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.short_code', { defaultValue: 'Kürzel' })}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Building2 size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={myCompanyForm.short_code}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, short_code: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.responsible_person')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <User size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={myCompanyForm.responsible_person}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, responsible_person: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.tax_vat_id')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Shield size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={myCompanyForm.tax_vat_id}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, tax_vat_id: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.tax_number', { defaultValue: 'Steuernummer' })}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Shield size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={myCompanyForm.tax_number}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, tax_number: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.website')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Globe size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={myCompanyForm.website}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, website: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
        </div>
      </div>

      {/* Contact Info */}
      <div className="space-y-8">
        <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.3em] font-display border-b border-white/5 pb-2">{t('my_company.communication_vectors')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.email_central')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Mail size={20} className="text-slate-700" />
              <input 
                type="email" 
                value={myCompanyForm.email_address}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, email_address: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.email_backup')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Mail size={20} className="text-slate-700" />
              <input 
                type="email" 
                value={myCompanyForm.email_2 || ''}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, email_2: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.phone')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Smartphone size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={myCompanyForm.phone_number}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, phone_number: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.mobile')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Smartphone size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={myCompanyForm.mobile_number || ''}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, mobile_number: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
        </div>
      </div>

       {/* Address */}
       <div className="space-y-8">
        <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.3em] font-display border-b border-white/5 pb-2">{t('my_company.geo_coords')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.street')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <input 
                type="text" 
                value={myCompanyForm.street}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, street: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.house_number')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <input 
                type="text" 
                value={myCompanyForm.house_number}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, house_number: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.zip')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <input 
                type="text" 
                value={myCompanyForm.postal_code}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, postal_code: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="md:col-span-1 space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.city')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <input 
                type="text" 
                value={myCompanyForm.city}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, city: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="md:col-span-1 space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.country')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <input 
                type="text" 
                value={myCompanyForm.country_code}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, country_code: e.target.value.toUpperCase().slice(0, 2)})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
        </div>
      </div>

      {/* Financial */}
      <div className="space-y-8">
        <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.3em] font-display border-b border-white/5 pb-2">{t('my_company.financial_vectors')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.iban')}</label>
            <div className={`bg-primary-dark/60 border ${ibanError ? 'border-red-500/50' : 'border-white/5'} rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner`}>
              <CreditCard size={20} className={`${ibanError ? 'text-red-500' : 'text-slate-700'}`} />
              <input 
                type="text" 
                value={myCompanyForm.iban}
                onChange={(e) => handleIbanChange(e.target.value)}
                placeholder={t('my_company.iban_placeholder', { defaultValue: 'DE89...' })}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight font-mono placeholder:text-slate-800" 
              />
            </div>
            {ibanError && (
              <p className="text-red-500 text-xs font-bold mt-1 ml-4 uppercase tracking-wider">{ibanError}</p>
            )}
            {isValidatingIban && (
              <p className="text-accent-blue text-xs font-black mt-1 ml-4 uppercase tracking-widest flex items-center gap-2 font-mono animate-pulse">
                <Loader2 size={12} className="animate-spin" /> {t('my_company.live_check', { defaultValue: 'Live-Prüfung...' })}
              </p>
            )}
            {myCompanyForm.bank_name && !ibanError && !isValidatingIban && (
              <p className="text-emerald-500 text-xs font-black mt-1 ml-4 uppercase tracking-widest flex items-center gap-2 font-mono">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                {t('my_company.bank_label', { defaultValue: 'Bank' })}: {myCompanyForm.bank_name === 'Unbekannte Bank' ? t('my_company.unknown_bank', { defaultValue: 'Unbekannte Bank' }) : myCompanyForm.bank_name}
              </p>
            )}
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.bic')}</label>
            <div className={`bg-primary-dark/60 border ${bicError ? 'border-red-500/50' : 'border-white/5'} rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner`}>
              <Key size={20} className={`${bicError ? 'text-red-500' : 'text-slate-700'}`} />
              <input 
                type="text" 
                value={myCompanyForm.bic_swift}
                onChange={(e) => handleBicChange(e.target.value)}
                placeholder="BIC..."
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight font-mono placeholder:text-slate-800" 
              />
            </div>
            {bicError && (
              <p className="text-red-500 text-xs font-bold mt-1 ml-4 uppercase tracking-wider">{bicError}</p>
            )}
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('my_company.leitweg_id')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Server size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={myCompanyForm.leitweg_id}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, leitweg_id: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('common:standard_vat_rate')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <CreditCard size={20} className="text-slate-700" />
              <input 
                type="number" 
                value={myCompanyForm.vat_rate}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, vat_rate: parseFloat(e.target.value) || 0})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('common:currency_code')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Database size={20} className="text-slate-700" />
              <select 
                value={myCompanyForm.currency_code}
                onChange={(e) => setMyCompanyForm({...myCompanyForm, currency_code: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight appearance-none"
              >
                <option value="EUR" className="bg-primary-dark">{t('my_company.currency_eur_symbol', { defaultValue: 'EUR (€)' })}</option>
                <option value="USD" className="bg-primary-dark">{t('my_company.currency_usd_symbol', { defaultValue: 'USD ($)' })}</option>
                <option value="GBP" className="bg-primary-dark">{t('my_company.currency_gbp_symbol', { defaultValue: 'GBP (£)' })}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Invoice Numbering Scheme (Nummernkreis) */}
      <div className="space-y-8">
        <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.3em] font-display border-b border-white/5 pb-2">
          {t('my_company.invoice_number_range', { defaultValue: 'Rechnungsnummernkreis (GoBD / DE)' })}
        </h4>
        <div className="bg-primary-dark/40 border border-white/5 rounded-2xl p-8 space-y-6">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider opacity-80">
            {t('my_company.invoice_number_explanation', { defaultValue: 'Konfigurieren Sie hier einen gesetzeskonformen, fortlaufenden Nummernkreis für Ihre Rechnungen nach deutschen Vorschriften.' })}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">
                {t('my_company.invoice_prefix', { defaultValue: 'Präfix (z.B. RE-)' })}
              </label>
              <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-5 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
                <input 
                  type="text" 
                  value={myCompanyForm.invoice_number_prefix}
                  onChange={(e) => setMyCompanyForm({...myCompanyForm, invoice_number_prefix: e.target.value})}
                  className="bg-transparent border-none focus:outline-none text-white font-black w-full text-base tracking-tight" 
                  placeholder={t('my_company.invoice_prefix_placeholder', { defaultValue: 'RE-' })}
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">
                {t('my_company.invoice_next_seq', { defaultValue: 'Nächste laufende Nummer' })}
              </label>
              <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-5 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
                <input 
                  type="number" 
                  min="1"
                  required
                  value={myCompanyForm.invoice_number_next_seq}
                  onChange={(e) => setMyCompanyForm({...myCompanyForm, invoice_number_next_seq: Math.max(1, parseInt(e.target.value) || 1)})}
                  className="bg-transparent border-none focus:outline-none text-white font-black w-full text-base tracking-tight" 
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">
                {t('my_company.invoice_min_digits', { defaultValue: 'Mindeststellen (Padding)' })}
              </label>
              <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-5 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
                <input 
                  type="number" 
                  min="1"
                  max="10"
                  required
                  value={myCompanyForm.invoice_number_min_digits}
                  onChange={(e) => setMyCompanyForm({...myCompanyForm, invoice_number_min_digits: Math.min(10, Math.max(1, parseInt(e.target.value) || 4))})}
                  className="bg-transparent border-none focus:outline-none text-white font-black w-full text-base tracking-tight" 
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">
                {t('my_company.invoice_year_fixed', { defaultValue: 'Fixiert auf Geschäftsjahr' })}
              </label>
              <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-5 flex items-center justify-between focus-within:border-accent-blue transition-all h-[66px] shadow-inner">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  {myCompanyForm.invoice_number_year_fixed ? t('common:activated') : t('common:deactivated')}
                </span>
                <input 
                  type="checkbox"
                  checked={myCompanyForm.invoice_number_year_fixed}
                  onChange={(e) => setMyCompanyForm({...myCompanyForm, invoice_number_year_fixed: e.target.checked})}
                  className="w-5 h-5 accent-accent-orange cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Interactive Live Preview Box */}
          <div className="mt-8 pt-6 border-t border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                {t('my_company.live_preview', { defaultValue: 'Vorschau der Rechnungsnummer' })}
              </h5>
              <p className="text-[11px] text-slate-600 font-semibold uppercase tracking-wider">
                {t('my_company.preview_desc', { defaultValue: 'So wird Ihre nächste Rechnungsnummer aussehen:' })}
              </p>
            </div>
            <div className="bg-primary-dark border border-white/10 rounded-xl px-6 py-4 flex items-center justify-center font-mono text-base font-black tracking-widest text-accent-blue">
              {(() => {
                const year = new Date().getFullYear();
                const padded = String(myCompanyForm.invoice_number_next_seq).padStart(myCompanyForm.invoice_number_min_digits, '0');
                const pfx = myCompanyForm.invoice_number_prefix;
                if (myCompanyForm.invoice_number_year_fixed) {
                  if (pfx.includes('YYYY')) {
                    return pfx.replace('YYYY', String(year)) + padded;
                  } else if (pfx.includes('{year}')) {
                    return pfx.replace('{year}', String(year)) + padded;
                  } else {
                    return `${pfx}${year}-${padded}`;
                  }
                } else {
                  return `${pfx}${padded}`;
                }
              })()}
            </div>
          </div>
        </div>
      </div>

      <div className="pt-8 border-t border-white/5 flex justify-end gap-4">
        <button 
          type="button"
          onClick={() => utils.getMyCompany.invalidate()}
          className="px-8 py-4 rounded-xl bg-primary-dark border border-white/10 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-white transition-colors font-display"
        >
          {t('common:discard')}
        </button>
        <button 
          type="submit"
          disabled={saveMyCompanyMutation.isPending}
          className="px-12 py-4 rounded-xl bg-accent-orange shadow-xl shadow-accent-orange/20 text-white font-black text-[12px] uppercase tracking-widest hover:bg-accent-orange/90 transition-all font-display disabled:opacity-50 flex items-center gap-3"
        >
          {saveMyCompanyMutation.isPending && <Loader2 className="animate-spin" size={18} />}
          {t('my_company.save')}
        </button>
      </div>
    </form>
  );
};
