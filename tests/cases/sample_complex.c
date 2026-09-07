#include "sample_complex.h"

void init_database(t_database *db){db->count=0;}

int add_user(t_database *db,const char *name,int age,double score)
{
if(!db || db->count>=MAX_USERS)return -1;
t_user *u=&db->users[db->count];
u->id=db->count+1; strncpy(u->name,name,MAX_NAME_LEN-1); u->name[MAX_NAME_LEN-1]='\0';
u->age=age; u->score=score;
db->count++;
return u->id;
}

void print_user(const t_user *user)
{
if(!user)return;
printf("ID:%d Name:%s Age:%d Score:%f\n",user->id,user->name,user->age,user->score);
}

void print_database(const t_database *db)
{
if(!db)return;
for(int i=0;i<db->count;i++) print_user(&db->users[i]);
}

t_user *find_user_by_id(t_database *db,int id)
{
if(!db)return NULL;
for(int i=0;i<db->count;i++) if(db->users[i].id==id)return &db->users[i];
return NULL;
}

void remove_user_by_id(t_database *db,int id)
{
if(!db)return;
for(int i=0;i<db->count;i++)
{
if(db->users[i].id==id)
{
for(int j=i;j<db->count-1;j++) db->users[j]=db->users[j+1];
db->count--;
return;
}
}
}

void update_score(t_database *db,int id,double score)
{
t_user *u=find_user_by_id(db,id);
if(u)u->score=score;
}

int load_users_from_file(t_database *db,const char *filename)
{
FILE *f=fopen(filename,"r");
if(!f)return -1;
char name[MAX_NAME_LEN]; int age; double score;
while(fscanf(f,"%63s %d %lf",name,&age,&score)==3)
{
add_user(db,name,age,score);
}
fclose(f);
return db->count;
}

int save_users_to_file(const t_database *db,const char *filename)
{
FILE *f=fopen(filename,"w");
if(!f)return -1;
for(int i=0;i<db->count;i++)
{
fprintf(f,"%s %d %f\n",db->users[i].name,db->users[i].age,db->users[i].score);
}
fclose(f);
return 0;
}

int sum_array(int *arr,int size)
{
int sum=0;
for(int i=0;i<size;i++)sum+=arr[i];
return sum;
}

double average_array(int *arr,int size)
{
if(size==0)return 0;
return (double)sum_array(arr,size)/size;
}

void bubble_sort(int *arr,int size)
{
for(int i=0;i<size-1;i++)
{
for(int j=0;j<size-i-1;j++)
{
if(arr[j]>arr[j+1])
{
int tmp=arr[j];arr[j]=arr[j+1];arr[j+1]=tmp;
}
}
}
}

void reverse_string(char *str)
{
if(!str)return;
int len=strlen(str);
for(int i=0;i<len/2;i++)
{
char t=str[i];
str[i]=str[len-i-1];
str[len-i-1]=t;
}
}

int main()
{
t_database db;
init_database(&db);

add_user(&db,"alice",20,88.5); add_user(&db,"bob",22,91.2);
add_user(&db,"charlie",19,72.4);

print_database(&db);

update_score(&db,2,95.0);

printf("After update:\n"); print_database(&db);

int arr[10]={5,3,8,1,2,9,4,7,6,0};

bubble_sort(arr,10);

for(int i=0;i<10;i++)printf("%d ",arr[i]);
printf("\n");

char text[BUFFER_SIZE]="formatter_test_string";
reverse_string(text);
printf("%s\n",text);

return 0;
}
