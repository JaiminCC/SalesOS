# Campaign templates

A template has a subject, a plain-text body, optional HTML, a locale, and an optional product. Creating a template writes version 1. The only variables are `{{company_name}}`, `{{contact_first_name}}`, `{{product_name}}`, `{{industry}}`, and `{{verified_pain_point}}`. Any other token is `TEMPLATE_VARIABLE`. Script markup is `TEMPLATE_MARKUP`.

Rendering escapes HTML when requested. Carriage returns and line feeds in a value collapse to a single space so a value cannot add a header. A missing value becomes empty and is listed. It is not replaced with an invented fact. Saving or rendering a template does not create a send intent.
