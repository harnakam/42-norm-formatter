void *main(void *i);
int (*fpfunc)(int x,int y);
int main(){
int result;
result=(*fpfunc)(1,2);
return(result);
}
