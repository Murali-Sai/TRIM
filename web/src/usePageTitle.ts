import { useEffect } from 'react';
import { FULL_FORM, PRODUCT_NAME } from './components/TitleBlock';

export const LANDING_TITLE = `${PRODUCT_NAME}: ${FULL_FORM}`;

/** Sets the browser tab title: "Today, TRIM" inside the app, the full name when `page` is null. */
export function usePageTitle(page: string | null) {
  useEffect(() => {
    document.title = page === null ? LANDING_TITLE : `${page}, ${PRODUCT_NAME}`;
  }, [page]);
}
