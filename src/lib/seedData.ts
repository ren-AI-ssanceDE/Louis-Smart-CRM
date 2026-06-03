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
      status: "draft",
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
      status: "draft",
      payment_method: "credit_card",
      line_items: [
        { description: "Implementierung Phase 1", quantity: 100, unit_price: 125, vat_rate: 19, total_net: 12500, unit_code: "HUR" }
      ]
    }
  ]
};
