// The starting category templates (07 §4.1). Names are i18n keys in the `templates` bundle; the budget is
// created with them in the UI language at that moment, and they're never re-translated (20 §3.8).
import type { BudgetTemplate } from '@shared/rpc/host-api';
import type { TemplateId } from './stores/start';

const TEMPLATES: Record<TemplateId, { group: string; categories: string[] }[]> = {
  personal: [
    {
      group: 'templates.groupGiving',
      categories: ['templates.catTithing', 'templates.catCharitable'],
    },
    {
      group: 'templates.groupMonthlyBills',
      categories: [
        'templates.catRentMortgage',
        'templates.catPhone',
        'templates.catInternet',
        'templates.catCableTv',
        'templates.catElectricity',
        'templates.catWater',
        'templates.catNaturalGas',
      ],
    },
    {
      group: 'templates.groupEverydayExpenses',
      categories: [
        'templates.catGroceries',
        'templates.catFuel',
        'templates.catSpendingMoney',
        'templates.catRestaurants',
        'templates.catMedical',
        'templates.catClothing',
        'templates.catHouseholdGoods',
      ],
    },
    {
      group: 'templates.groupRainyDayFunds',
      categories: [
        'templates.catEmergencyFund',
        'templates.catCarRepairs',
        'templates.catHomeMaintenance',
        'templates.catCarInsurance',
        'templates.catLifeInsurance',
        'templates.catHealthInsurance',
        'templates.catBirthdays',
        'templates.catChristmas',
      ],
    },
    {
      group: 'templates.groupSavingsGoals',
      categories: ['templates.catCarReplacement', 'templates.catVacation'],
    },
    {
      group: 'templates.groupDebt',
      categories: [
        'templates.catCarPayment',
        'templates.catStudentLoanPayment',
        'templates.catPersonalLoanPayment',
      ],
    },
  ],
  business: [
    {
      group: 'templates.groupMarketing',
      categories: [
        'templates.catPrinting',
        'templates.catOnline',
        'templates.catReferralFees',
        'templates.catCommissions',
      ],
    },
    {
      group: 'templates.groupServices',
      categories: [
        'templates.catAccounting',
        'templates.catLegal',
        'templates.catContractors',
        'templates.catOther',
      ],
    },
    {
      group: 'templates.groupOffice',
      categories: ['templates.catRent', 'templates.catTelephoneFax', 'templates.catInternet'],
    },
    {
      group: 'templates.groupGeneral',
      categories: ['templates.catMealsEntertainment', 'templates.catOfficeSupplies'],
    },
    {
      group: 'templates.groupTravel',
      categories: [
        'templates.catAutomobile',
        'templates.catHotelsLodging',
        'templates.catAirfare',
        'templates.catOther',
      ],
    },
    {
      group: 'templates.groupTaxesLicenses',
      categories: ['templates.catUnemployment', 'templates.catPayroll', 'templates.catQuarterlies'],
    },
  ],
};

/** The template with its names translated, as `budgetFile.create` takes it. */
export function translatedTemplate(id: TemplateId, t: (key: string) => string): BudgetTemplate {
  return {
    groups: TEMPLATES[id].map((g) => ({ name: t(g.group), categories: g.categories.map(t) })),
    incomeCategory: t('templates.income'),
  };
}
