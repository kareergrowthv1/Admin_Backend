const { execSync } = require('child_process');
try {
  const out = execSync('/Users/ifocus/.nvm/versions/node/v22.21.1/bin/node test_create_position.js');
  console.log(out.toString());
} catch(e) {
  console.log(e.stdout.toString());
  console.log(e.stderr.toString());
}
