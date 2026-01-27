import bcrypt from "bcrypt";

const plainPassword = "+Alexcaroline12";

bcrypt.hash(plainPassword, 10).then((hash) => {
  console.log("Generated hash:", hash);
});
