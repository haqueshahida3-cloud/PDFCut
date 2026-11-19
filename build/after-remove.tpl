#!/bin/bash

# Delete the launcher link. The alternative is registered for the launcher, not the binary.
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/resources/pdfcut-launcher.sh' || true
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' 2>/dev/null || true
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the policy is not left enforced
  # until the next reboot. Live AppArmor operations are not meaningful inside a chroot.
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
