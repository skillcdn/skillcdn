import { defineSite } from "@skillcdn/web";
import { PacksPage } from "./packs-page.js";

// A configuration of an installation, as an example and as what the tests build: one page of
// its own in the header's menu. A build is given it by its path:
//
//   SKILLCDN_WEB_CONFIG=examples/site/site.config.tsx pnpm --filter @skillcdn/web run build
//
// and `dist/` is then a UI with the page at /pages/packs (apps/web/README.md, "Pages of an
// installation's own").
export const site = defineSite({
  pages: [
    {
      key: "packs",
      label: { en: "Packs", ko: "팩" },
      menu: true,
      render: (context) => <PacksPage {...context} />,
    },
  ],
});
