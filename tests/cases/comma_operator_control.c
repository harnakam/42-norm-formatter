int main(void){
int a;
int b;
a = 0;
b = 0;
if((a = 1, b = 2, a < b))
a++;
return(a);
}
