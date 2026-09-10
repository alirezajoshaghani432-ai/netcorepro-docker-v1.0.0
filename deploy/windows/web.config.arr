<?xml version="1.0" encoding="UTF-8"?>
<!--
  NetCore Pro - IIS Application Request Routing (ARR) configuration
  Mode: Reverse-proxy IIS -> Node.js running on http://localhost:3000

  Prerequisites:
    1. Install URL Rewrite 2.x: https://www.iis.net/downloads/microsoft/url-rewrite
    2. Install Application Request Routing 3.0: https://www.iis.net/downloads/microsoft/application-request-routing
    3. Enable proxy: IIS Manager -> server node -> Application Request Routing Cache -> Server Proxy Settings -> "Enable proxy"
    4. Run Node app via PM2/NSSM on port 3000

  To use this file: rename to web.config (replacing iisnode version).
-->
<configuration>
  <system.webServer>

    <rewrite>
      <rules>
        <rule name="ReverseProxyToNode" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:3000/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
            <set name="HTTP_X_FORWARDED_FOR" value="{REMOTE_ADDR}" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>

    <httpProtocol>
      <customHeaders>
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="X-Frame-Options" value="SAMEORIGIN" />
        <add name="Referrer-Policy" value="strict-origin-when-cross-origin" />
      </customHeaders>
    </httpProtocol>

    <urlCompression doStaticCompression="true" doDynamicCompression="true" />

    <security>
      <requestFiltering>
        <requestLimits maxAllowedContentLength="20971520" />
      </requestFiltering>
    </security>

  </system.webServer>
</configuration>
