// The one tag the app owns in transaction notes (04 §5.1–5.2): needs-review. Every other tag is user data.
import { APP_NAME } from '../app';

export const REVIEW_TAG = 'needs-review';

/**
 * The color the protected `needs-review` tag entity gets when first created: Light `--review-row-border`
 * (05 §1.7). It syncs to every client, so it never follows the user's palette.
 */
export const REVIEW_TAG_COLOR = '#96A6D9';

/** The description stored on the `needs-review` tag entity (04 §5.2). Synced data, so it isn't translated. */
export const REVIEW_TAG_DESCRIPTION = `Used by ${APP_NAME} for transaction review`;

/** The prefix of YNAB's flag tags. They are ordinary user tags with no special behavior (04 §5.1). */
export const FLAG_TAG_PREFIX = 'flag-';

/** The description the Discover dialog's "Add YNAB flags" gives each flag tag (04 §5.2). Synced, untranslated. */
export const FLAG_TAG_DESCRIPTION = `Used by ${APP_NAME} for transaction flags`;

/** The six YNAB flag tags "Add YNAB flags" creates (04 §5.2), by name, with their YNAB colors. */
export const FLAG_TAGS: readonly { tag: string; color: string }[] = [
  { tag: 'flag-blue', color: '#4A90D9' },
  { tag: 'flag-green', color: '#5AAE3E' },
  { tag: 'flag-orange', color: '#F0922E' },
  { tag: 'flag-purple', color: '#9461C9' },
  { tag: 'flag-red', color: '#E53935' },
  { tag: 'flag-yellow', color: '#E8C42A' },
];
