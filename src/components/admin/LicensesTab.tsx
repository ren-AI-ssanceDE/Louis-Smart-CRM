import React from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Copyright, ExternalLink, Scale, Code2, Heart, FileText } from 'lucide-react';

export const LicensesTab = () => {
  const { i18n } = useTranslation();
  const isDe = i18n.language === 'de';

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="border-b border-white/5 pb-6">
        <div className="flex items-center gap-4 mb-3">
          <div className="p-3 bg-accent-blue/10 rounded-2xl border border-accent-blue/20 shadow-lg shadow-accent-blue/10">
            <Scale className="text-accent-blue" size={28} />
          </div>
          <div>
            <h3 className="text-3xl font-black text-white italic uppercase tracking-tighter font-display">
              {isDe ? 'LIZENZEN & OPEN-SOURCE-CREDITS' : 'LICENSES & OPEN SOURCE CREDITS'}
            </h3>
            <p className="text-slate-500 text-xs font-bold italic opacity-70 tracking-wider font-display uppercase">
              {isDe 
                ? 'Informationen über Lizenzierung, Urheberrecht und Drittanbieter-Bibliotheken.' 
                : 'Information about licensing, copyrights, and third-party attribution.'}
            </p>
          </div>
        </div>
      </div>

      {/* Main License Card */}
      <div className="p-8 bg-primary-dark/50 border border-white/5 rounded-2xl space-y-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <Shield className="text-accent-orange shrink-0" size={22} />
            <h4 className="text-base font-black text-white uppercase tracking-wider font-display">
              {isDe ? 'Hauptlizenz: GPLv3' : 'Main License: GPLv3'}
            </h4>
          </div>
          <span className="px-3 py-1 bg-accent-orange/10 border border-accent-orange/20 text-accent-orange text-[10px] font-black uppercase tracking-widest rounded-full font-mono">
            GPLv3 Active
          </span>
        </div>

        <div className="space-y-4 text-xs leading-relaxed text-slate-300">
          <p>
            {isDe ? (
              <>
                <strong>Louis Smart CRM</strong> wird unter den Bedingungen der <strong>GNU General Public License Version 3 (GPLv3)</strong> veröffentlicht. Dies garantiert Ihnen die Freiheit, diese Software zu nutzen, zu studieren, zu teilen und zu modifizieren.
              </>
            ) : (
              <>
                <strong>Louis Smart CRM</strong> is released under the terms of the <strong>GNU General Public License Version 3 (GPLv3)</strong>. This guarantees your freedom to run, study, share, and modify this software.
              </>
            )}
          </p>

          {/* Copyright Section with Link */}
          <div className="bg-primary-dark/80 p-5 rounded-xl border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Copyright className="text-accent-blue shrink-0" size={18} />
              <div>
                <p className="font-bold text-white text-sm">
                  {isDe ? 'Lizenzgeber & Rechtinhaber' : 'Licensor & Copyright Holder'}
                </p>
                <p className="text-slate-400 text-xs font-mono">ren-AI-ssance®</p>
              </div>
            </div>
            <a 
              href="https://www.ren-ai-ssance.de" 
              target="_blank" 
              rel="noopener noreferrer" 
              title="ren-AI-ssance Website"
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/20 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all duration-300"
            >
              www.ren-ai-ssance.de
              <ExternalLink size={12} />
            </a>
          </div>

          <p className="text-[11px] text-slate-400 italic">
            {isDe ? (
              <>
                „Diese Software wird in der Hoffnung verbreitet, dass sie nützlich sein wird, aber OHNE JEDE GEWÄHRLEISTUNG; sogar ohne die implizite Gewährleistung der MARKTGÄNGLICHKEIT oder EIGNUNG FÜR EINEN BESTIMMTEN ZWECK. Siehe die GNU General Public License für weitere Details.“
              </>
            ) : (
              <>
                &ldquo;This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.&rdquo;
              </>
            )}
          </p>
        </div>
      </div>

      {/* Third Party / Licensors Credits */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 border-b border-white/5 pb-2">
          <Code2 className="text-accent-blue" size={18} />
          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] font-display">
            {isDe ? 'Dritthersteller & Open Source Credits' : 'Third-Party & Open Source Attributions'}
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Mustangproject Attribution */}
          <div className="p-6 bg-primary-dark/30 border border-white/5 rounded-xl space-y-4 hover:border-accent-orange/25 transition-all">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-white font-display">Mustangproject Library</span>
              <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-[9px] font-mono rounded">Apache-2.0</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isDe ? (
                <>
                  Verwendet für die regelkonforme CII-XML Generierung und Verschmelzung der PDF/A-3b ZUGFeRD 2.2+ / Factur-X 1.0 Rechnungsdateien.
                  <br />
                  <span className="text-slate-500 block mt-2 font-medium">Urheber &amp; Community: Mustangproject Contributors (Jochen Stärk)</span>
                </>
              ) : (
                <>
                  Utilized for fully standard-compliant CII-XML generation and e-invoice PDF/A-3b merging (Factur-X / ZUGFeRD 2.2+).
                  <br />
                  <span className="text-slate-500 block mt-2 font-medium">Copyright &amp; Community: Mustangproject Contributors (Jochen Stärk)</span>
                </>
              )}
            </p>
            <div className="pt-2 flex justify-end">
              <a 
                href="https://www.mustangproject.org" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-1.5 text-[11px] text-accent-orange hover:underline font-bold"
              >
                mustangproject.org
                <ExternalLink size={10} />
              </a>
            </div>
          </div>

          {/* pdf-lib Attribution */}
          <div className="p-6 bg-primary-dark/30 border border-white/5 rounded-xl space-y-4 hover:border-accent-blue/25 transition-all">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-white font-display">pdf-lib</span>
              <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-[9px] font-mono rounded">MIT License</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isDe ? (
                <>
                  Entwirft und rendert die visuellen Rechnungsseiten (Seitenübergänge, Texte, Tabellen und Strukturzeichnungen) dynamisch im Client- und Serverumfeld.
                  <br />
                  <span className="text-slate-500 block mt-2 font-medium">Urheber: Andrew Dillon &amp; pdf-lib Contributors</span>
                </>
              ) : (
                <>
                  Provides high-performance rendering of visual PDF invoices, structures, page flows, and dynamic tables.
                  <br />
                  <span className="text-slate-500 block mt-2 font-medium">Copyright: Andrew Dillon &amp; pdf-lib Contributors</span>
                </>
              )}
            </p>
            <div className="pt-2 flex justify-end">
              <a 
                href="https://pdf-lib.js.org" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-1.5 text-[11px] text-accent-blue hover:underline font-bold"
              >
                pdf-lib.js.org
                <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>

        {/* General Credits List */}
        <div className="p-6 bg-slate-900/20 border border-white/5 rounded-xl">
          <div className="flex items-center gap-2 mb-4">
            <Heart className="text-emerald-500 fill-emerald-500/10" size={16} />
            <h5 className="text-[11px] font-black text-white uppercase tracking-wide font-display">
              {isDe ? 'Vielen Dank an die Open Source Community' : 'Special Thanks to the Open Source Community'}
            </h5>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            {isDe 
              ? 'Dieses Projekt wird durch eine Vielzahl von bewährten Open-Source-Technologien getragen, darunter:'
              : 'This platform is powered by highly reliable open-source frameworks, including:'}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div className="bg-primary-dark/40 py-2.5 px-4 border border-white/5 rounded-lg text-slate-300">
              <span className="text-slate-500 text-[9px] block">Framework</span>
              <strong>React 18</strong>
            </div>
            <div className="bg-primary-dark/40 py-2.5 px-4 border border-white/5 rounded-lg text-slate-300">
              <span className="text-slate-500 text-[9px] block">Build Tool</span>
              <strong>Vite</strong>
            </div>
            <div className="bg-primary-dark/40 py-2.5 px-4 border border-white/5 rounded-lg text-slate-300">
              <span className="text-slate-500 text-[9px] block">CSS Platform</span>
              <strong>Tailwind CSS</strong>
            </div>
            <div className="bg-primary-dark/40 py-2.5 px-4 border border-white/5 rounded-lg text-slate-300">
              <span className="text-slate-500 text-[9px] block">Comms-Protocol</span>
              <strong>tRPC &amp; React-Query</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
