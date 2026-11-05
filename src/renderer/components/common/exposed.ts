// The methods the input components expose (defineExpose), as plain types: template refs to `.vue` imports
// can't be typed from the components themselves outside vue-tsc.

export interface FieldApi {
  focus(): void;
  select(): void;
}

export interface AutoCompleteApi extends FieldApi {
  open(): void;
  close(): void;
  element(): HTMLInputElement | null;
  reset(): void;
}

export interface DateFieldApi extends FieldApi {
  /** Commits the typed text; false (with the "Invalid date" callout) when it isn't a valid date. */
  commit(): boolean;
}

export interface MoneyInputApi extends FieldApi {
  calculatorOpen(): boolean;
}
