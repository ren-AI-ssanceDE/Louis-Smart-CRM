export const defaultCouncilSettings = {
  enabled: true,
  defaultMode: 'multi-role',
  defaultMaxRounds: 2,
  providers: [],
  members: [
    {
      id: 'contrarian',
      name: 'Der Kontrarian (The Contrarian)',
      providerId: 'gemini-default',
      modelId: 'gemini-2.5-flash',
      systemPrompt: 'Analysiere die Anfrage und konzentriere dich ausschließlich darauf, was schiefgehen wird. Ignoriere positive Aspekte. Liste alle Risiken, Schwachstellen und das schlimmste anzunehmende Szenario (Worst-Case) auf.',
      temperature: 0.4,
      weight: 1.0,
      isActive: true
    },
    {
      id: 'first_principles',
      name: 'Der Grundsatzdenker (The First-Principles Thinker)',
      providerId: 'gemini-default',
      modelId: 'gemini-2.5-flash',
      systemPrompt: 'Hinterfrage jede implizite Annahme in der Anfrage. Zerlege das Problem in seine fundamentalen Wahrheiten und frage dich, ob wir überhaupt versuchen, das richtige Problem zu lösen.',
      temperature: 0.5,
      weight: 1.0,
      isActive: true
    },
    {
      id: 'expansionist',
      name: 'Der Expansionist (The Expansionist)',
      providerId: 'gemini-default',
      modelId: 'gemini-2.5-flash',
      systemPrompt: 'Suche nach ungenutzten Potenzialen, Skalierungsmöglichkeiten und Vorteilen, die der Nutzer komplett übersehen hat. Denke groß und über den aktuellen Tellerrand hinaus.',
      temperature: 0.7,
      weight: 1.0,
      isActive: true
    },
    {
      id: 'outsider',
      name: 'Der Außenseiter (The Outsider)',
      providerId: 'gemini-default',
      modelId: 'gemini-2.5-flash',
      systemPrompt: 'Nimm an, du hättest keinerlei Branchenwissen oder Vorabkontext. Betrachte die Situation völlig naiv und stelle die offensichtlichen, simplen Fragen, die Experten oft übersehen.',
      temperature: 0.6,
      weight: 1.0,
      isActive: true
    },
    {
      id: 'executor',
      name: 'Der Umsetzer (The Executor)',
      providerId: 'gemini-default',
      modelId: 'gemini-2.5-flash',
      systemPrompt: 'Konzentriere dich rein auf die Praxis. Ignoriere graue Theorie. Was sind die konkreten, pragmatischen Schritte, die der Nutzer direkt am nächsten Montagmorgen umsetzen muss?',
      temperature: 0.3,
      weight: 1.0,
      isActive: true
    }
  ],
  peerReviewPrompt: `Du bist ein anonymer Gutachter. Vor dir liegen 5 verschiedene Lösungsansätze für dieselbe Aufgabe. Analysiere diese unabhängig und unvoreingenommen.
1. Welche Antwort ist argumentativ am stärksten und warum?
2. Welche Antwort hat den größten blinden Fleck (Blind Spot)?
3. Welchen entscheidenden Punkt haben alle 5 Antworten bisher komplett übersehen?
4. Erstelle ein rationales Ranking der Antworten von Platz 1 bis 5.`,
  chairmanPrompt: `Du bist der Vorsitzende (Chairman) des Expertenrats. Deine Aufgabe ist es nicht, einfach eine Zusammenfassung zu schreiben, sondern eine finale Entscheidung zu treffen.
1. Analysiere die 5 Perspektiven sowie deren gegenseitige Kritik und Bewertungen.
2. Wo herrscht im Council Konsens, wo gibt es unvereinbare Konflikte?
3. Synthetisiere die besten Elemente zu einer finalen, unanfechtbaren Antwort.
4. Beende deine Antwort mit einer klaren, unmissverständlichen Handlungsempfehlung und den nächsten drei Schritten für den Nutzer.`,
  fallbackProviderId: 'gemini-default',
  fallbackModelId: 'gemini-2.5-flash'
};

export const seedData = {
  myCompany: {
    full_legal_name: "CYBERDYNE SYSTEMS GmbH",
    tax_vat_id: "DE 123 456 789",
    responsible_person: "Miles Dyson",
    first_name: "Admin",
    last_name: "",
    street: "Innovation Blvd",
    house_number: "101",
    postal_code: "80331",
    city: "München",
    country_code: "DE",
    email_address: "contact@cyberdyne.io",
    website: "https://cyberdyne.io",
    phone_number: "+49 89 0000000",
    iban: "DE12 3456 7890 1234 5678 00",
    bic_swift: "CYBERDEXXX",
    bank_name: "Cyberdyne Bundesbank",
    leitweg_id: "991:12345-67890-99",
    vat_rate: 19,
    currency_code: "EUR",
    language: "de",
    invoice_number_prefix: "RE-",
    invoice_number_year_fixed: true,
    invoice_number_next_seq: 1,
    invoice_number_min_digits: 4
  },
  companies: [
    {
      full_legal_name: "Muster GmbH & Co. KG",
      tax_vat_id: "DE123456789",
      responsible_person: "Manfred Muster",
      street: "Beispielstraße",
      house_number: "42",
      city: "Musterstadt",
      postal_code: "12345",
      country_code: "DE",
      email_address: "info@muster-gmbh.de",
      website: "https://muster-gmbh.de",
      iban: "DE00123456780000123456",
      bic_swift: "ABCDEFGH123",
      payment_term: "net_30",
      price_list: "standard",
      language: "de",
      ai_confidence_score: 1.0,
      is_verified_by_human: true
    },
    {
      full_legal_name: "Omni Consumer Products (OCP)",
      tax_vat_id: "US 999 888 777",
      responsible_person: "The Old Man",
      street: "Industrial Way",
      house_number: "22",
      postal_code: "48201",
      city: "Detroit",
      country_code: "US",
      email_address: "info@ocp.corp",
      website: "https://ocp.corp",
      iban: "US12 9999 8888 7777 6666 55",
      bic_swift: "OCPCUS33",
      payment_term: "net_30",
      price_list: "standard",
      language: "en",
      ai_confidence_score: 0.98,
      is_verified_by_human: true
    },
    {
      full_legal_name: "Weyland-Yutani Corp",
      tax_vat_id: "UK 111 222 333",
      responsible_person: "Peter Weyland",
      street: "Space Explorer Road",
      house_number: "7",
      postal_code: "EC1A 1BB",
      city: "London",
      country_code: "GB",
      email_address: "building@betterworlds.com",
      website: "https://weyland-yutani.com",
      payment_term: "immediate",
      price_list: "premium",
      language: "en",
      ai_confidence_score: 0.95,
      is_verified_by_human: false
    }
  ],
  contacts: [
    {
      company_name: "Muster GmbH & Co. KG",
      salutation: "herr",
      first_name: "Max",
      last_name: "Mustermann",
      email_address: "max.mustermann@example.com",
      phone_number: "+49 170 1234567",
      role: "Ansprechpartner",
      gender_identity: "m"
    },
    {
      company_name: "Omni Consumer Products (OCP)",
      salutation: "herr",
      first_name: "Bob",
      last_name: "Morton",
      email_address: "b.morton@ocp.corp",
      phone_number: "+1 313 555 0199",
      role: "VP Special Projects",
      gender_identity: "m"
    },
    {
      company_name: "Weyland-Yutani Corp",
      salutation: "frau",
      first_name: "Ellen",
      last_name: "Ripley",
      email_address: "e.ripley@weyland-yutani.com",
      phone_number: "+44 20 7946 0000",
      role: "Warrant Officer",
      gender_identity: "f"
    }
  ],
  invoices: [
    {
      invoice_number: "RE-2024-001",
      company_name: "Omni Consumer Products (OCP)",
      issue_date_utc: "2024-05-01",
      due_date_utc: "2024-05-31",
      total_net: 5000.00,
      total_vat: 950.00,
      total_gross: 5950.00,
      currency_code: "EUR",
      payment_status: "draft",
      payment_method: "bank_transfer",
      line_items: [
        { description: "Beratung Q2", quantity: 40, unit_price: 100, vat_rate: 19, total_net: 4000, unit_code: "HUR" },
        { description: "Lizenzgebühr", quantity: 1, unit_price: 1000, vat_rate: 19, total_net: 1000, unit_code: "C62" }
      ]
    },
    {
      invoice_number: "RE-2024-002",
      company_name: "Weyland-Yutani Corp",
      issue_date_utc: "2024-05-10",
      due_date_utc: "2024-05-10",
      total_net: 12500.00,
      total_vat: 2375.00,
      total_gross: 14875.00,
      currency_code: "EUR",
      payment_status: "draft",
      payment_method: "credit_card",
      line_items: [
        { description: "Implementierung Phase 1", quantity: 100, unit_price: 125, vat_rate: 19, total_net: 12500, unit_code: "HUR" }
      ]
    }
  ]
};
